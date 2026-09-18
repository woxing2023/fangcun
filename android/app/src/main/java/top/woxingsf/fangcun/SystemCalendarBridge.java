package top.woxingsf.fangcun;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/** Owns the local "方寸" calendar exposed by Android's Calendar Provider. */
final class SystemCalendarBridge {
    private static final String ACCOUNT_PREFIX = "fangcun-";
    private static final String ACCOUNT_TYPE = CalendarContract.ACCOUNT_TYPE_LOCAL;
    private static final String CALENDAR_NAME = "fangcun";
    private final Context context;

    SystemCalendarBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    boolean hasPermission() {
        return context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    String read(String requestedAccount) {
        JSONObject result = new JSONObject();
        try {
            result.put("permission", hasPermission());
            if (!hasPermission()) return result.toString();
            String account = accountName(requestedAccount);
            long calendarId = findCalendar(account);
            result.put("calendarId", calendarId > 0 ? calendarId : JSONObject.NULL);
            result.put("events", calendarId > 0 ? readEvents(calendarId, account) : new JSONArray());
        } catch (Exception error) {
            putError(result, error);
        }
        return result.toString();
    }

    String sync(String payload) {
        JSONObject result = new JSONObject();
        try {
            result.put("permission", hasPermission());
            if (!hasPermission()) return result.toString();
            JSONObject root = new JSONObject(payload == null ? "{}" : payload);
            String account = accountName(root.optString("account", "default"));
            String displayName = root.optString("displayName", "方寸").trim();
            long calendarId = ensureCalendar(account, displayName.isEmpty() ? "方寸" : "方寸 · " + displayName);
            JSONArray desired = root.optJSONArray("events");
            if (desired == null) desired = new JSONArray();

            Map<String, Long> existing = markedEventIds(calendarId, account);
            Set<String> retained = new HashSet<>();
            int inserted = 0;
            int updated = 0;
            for (int index = 0; index < desired.length(); index += 1) {
                JSONObject item = desired.optJSONObject(index);
                if (item == null) continue;
                String key = item.optString("key", "").trim();
                if (key.isEmpty() || key.length() > 240) continue;
                retained.add(key);
                Long eventId = existing.get(key);
                if (eventId == null && item.optLong("nativeId", 0) > 0) eventId = item.optLong("nativeId");
                if (eventId == null || eventId <= 0) {
                    eventId = insertEvent(calendarId, account, key, item);
                    if (eventId > 0) inserted += 1;
                } else {
                    updateEvent(eventId, calendarId, account, key, item);
                    updated += 1;
                }
                if (eventId > 0) replaceReminder(eventId, item.optInt("reminderMinutes", -1));
            }

            int deleted = 0;
            for (Map.Entry<String, Long> entry : existing.entrySet()) {
                if (retained.contains(entry.getKey())) continue;
                Uri eventUri = ContentUris.withAppendedId(Events.CONTENT_URI, entry.getValue());
                deleted += context.getContentResolver().delete(asSyncAdapter(eventUri, account), null, null);
            }
            result.put("calendarId", calendarId);
            result.put("inserted", inserted);
            result.put("updated", updated);
            result.put("deleted", deleted);
            result.put("events", readEvents(calendarId, account));
        } catch (Exception error) {
            putError(result, error);
        }
        return result.toString();
    }

    private long findCalendar(String account) {
        String[] projection = { Calendars._ID };
        String selection = Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=? AND " + Calendars.NAME + "=?";
        try (Cursor cursor = context.getContentResolver().query(Calendars.CONTENT_URI, projection, selection, new String[]{account, ACCOUNT_TYPE, CALENDAR_NAME}, null)) {
            return cursor != null && cursor.moveToFirst() ? cursor.getLong(0) : -1;
        }
    }

    private long ensureCalendar(String account, String displayName) {
        long existing = findCalendar(account);
        if (existing > 0) return existing;
        ContentValues values = new ContentValues();
        values.put(Calendars.ACCOUNT_NAME, account);
        values.put(Calendars.ACCOUNT_TYPE, ACCOUNT_TYPE);
        values.put(Calendars.NAME, CALENDAR_NAME);
        values.put(Calendars.CALENDAR_DISPLAY_NAME, displayName);
        values.put(Calendars.CALENDAR_COLOR, Color.rgb(45, 91, 70));
        values.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER);
        values.put(Calendars.OWNER_ACCOUNT, account);
        values.put(Calendars.VISIBLE, 1);
        values.put(Calendars.SYNC_EVENTS, 1);
        values.put(Calendars.ALLOWED_REMINDERS, String.valueOf(Reminders.METHOD_ALERT));
        Uri inserted = context.getContentResolver().insert(asSyncAdapter(Calendars.CONTENT_URI, account), values);
        if (inserted == null) throw new IllegalStateException("无法创建方寸系统日历");
        return ContentUris.parseId(inserted);
    }

    private Map<String, Long> markedEventIds(long calendarId, String account) {
        Map<String, Long> result = new HashMap<>();
        String[] projection = { Events._ID, Events.SYNC_DATA1 };
        String selection = Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0";
        try (Cursor cursor = context.getContentResolver().query(asSyncAdapter(Events.CONTENT_URI, account), projection, selection, new String[]{String.valueOf(calendarId)}, null)) {
            while (cursor != null && cursor.moveToNext()) {
                String key = cursor.getString(1);
                if (key != null && !key.isEmpty()) result.put(key, cursor.getLong(0));
            }
        }
        return result;
    }

    private long insertEvent(long calendarId, String account, String key, JSONObject item) throws JSONException {
        ContentValues values = eventValues(calendarId, key, item);
        Uri inserted = context.getContentResolver().insert(asSyncAdapter(Events.CONTENT_URI, account), values);
        return inserted == null ? -1 : ContentUris.parseId(inserted);
    }

    private void updateEvent(long eventId, long calendarId, String account, String key, JSONObject item) throws JSONException {
        ContentValues values = eventValues(calendarId, key, item);
        Uri eventUri = ContentUris.withAppendedId(Events.CONTENT_URI, eventId);
        context.getContentResolver().update(asSyncAdapter(eventUri, account), values, null, null);
    }

    private ContentValues eventValues(long calendarId, String key, JSONObject item) throws JSONException {
        ContentValues values = new ContentValues();
        long start = item.optLong("startAt", 0);
        long end = Math.max(start + 60000L, item.optLong("endAt", start + 3600000L));
        boolean allDay = item.optBoolean("allDay", false);
        values.put(Events.CALENDAR_ID, calendarId);
        values.put(Events.TITLE, bounded(item.optString("title", "未命名日程"), 240));
        values.put(Events.DESCRIPTION, bounded(item.optString("description", ""), 4000));
        values.put(Events.EVENT_LOCATION, bounded(item.optString("location", ""), 500));
        values.put(Events.DTSTART, start);
        values.put(Events.DTEND, end);
        values.put(Events.ALL_DAY, allDay ? 1 : 0);
        values.put(Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
        values.put(Events.AVAILABILITY, Events.AVAILABILITY_BUSY);
        values.put(Events.SYNC_DATA1, key);
        values.put(Events.SYNC_DATA3, bounded(item.optString("kind", "task"), 32));
        values.put(Events.SYNC_DATA2, contentHash(values, item.optInt("reminderMinutes", -1)));
        return values;
    }

    private void replaceReminder(long eventId, int minutes) {
        ContentResolver resolver = context.getContentResolver();
        resolver.delete(Reminders.CONTENT_URI, Reminders.EVENT_ID + "=?", new String[]{String.valueOf(eventId)});
        if (minutes < 0) return;
        ContentValues values = new ContentValues();
        values.put(Reminders.EVENT_ID, eventId);
        values.put(Reminders.MINUTES, Math.min(minutes, 60 * 24 * 30));
        values.put(Reminders.METHOD, Reminders.METHOD_ALERT);
        resolver.insert(Reminders.CONTENT_URI, values);
    }

    private JSONArray readEvents(long calendarId, String account) throws JSONException {
        JSONArray events = new JSONArray();
        String[] projection = {
            Events._ID, Events.TITLE, Events.DESCRIPTION, Events.EVENT_LOCATION,
            Events.DTSTART, Events.DTEND, Events.ALL_DAY, Events.SYNC_DATA1,
            Events.SYNC_DATA2, Events.SYNC_DATA3
        };
        String selection = Events.CALENDAR_ID + "=? AND " + Events.DELETED + "=0";
        try (Cursor cursor = context.getContentResolver().query(asSyncAdapter(Events.CONTENT_URI, account), projection, selection, new String[]{String.valueOf(calendarId)}, Events.DTSTART + " ASC")) {
            while (cursor != null && cursor.moveToNext()) {
                long eventId = cursor.getLong(0);
                int reminder = reminderMinutes(eventId);
                ContentValues values = new ContentValues();
                values.put(Events.TITLE, empty(cursor.getString(1)));
                values.put(Events.DESCRIPTION, empty(cursor.getString(2)));
                values.put(Events.EVENT_LOCATION, empty(cursor.getString(3)));
                values.put(Events.DTSTART, cursor.getLong(4));
                values.put(Events.DTEND, cursor.getLong(5));
                values.put(Events.ALL_DAY, cursor.getInt(6));
                JSONObject event = new JSONObject();
                event.put("nativeId", eventId);
                event.put("title", empty(cursor.getString(1)));
                event.put("description", empty(cursor.getString(2)));
                event.put("location", empty(cursor.getString(3)));
                event.put("startAt", cursor.getLong(4));
                event.put("endAt", cursor.getLong(5));
                event.put("allDay", cursor.getInt(6) == 1);
                event.put("key", empty(cursor.getString(7)));
                event.put("syncHash", empty(cursor.getString(8)));
                event.put("kind", empty(cursor.getString(9)));
                event.put("reminderMinutes", reminder);
                event.put("contentHash", contentHash(values, reminder));
                events.put(event);
            }
        }
        return events;
    }

    private int reminderMinutes(long eventId) {
        String[] projection = { Reminders.MINUTES };
        try (Cursor cursor = context.getContentResolver().query(Reminders.CONTENT_URI, projection, Reminders.EVENT_ID + "=?", new String[]{String.valueOf(eventId)}, Reminders.MINUTES + " ASC")) {
            return cursor != null && cursor.moveToFirst() ? cursor.getInt(0) : -1;
        }
    }

    private static Uri asSyncAdapter(Uri uri, String account) {
        return uri.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(Calendars.ACCOUNT_NAME, account)
            .appendQueryParameter(Calendars.ACCOUNT_TYPE, ACCOUNT_TYPE)
            .build();
    }

    private static String contentHash(ContentValues values, int reminder) {
        String source = String.format(Locale.ROOT, "%s\u001f%s\u001f%s\u001f%s\u001f%s\u001f%s\u001f%d",
            values.getAsString(Events.TITLE), values.getAsString(Events.DESCRIPTION), values.getAsString(Events.EVENT_LOCATION),
            values.getAsLong(Events.DTSTART), values.getAsLong(Events.DTEND), values.getAsInteger(Events.ALL_DAY), reminder);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte item : digest) hex.append(String.format(Locale.ROOT, "%02x", item));
            return hex.toString();
        } catch (Exception ignored) {
            return Integer.toHexString(source.hashCode());
        }
    }

    private static String accountName(String value) {
        String safe = String.valueOf(value == null ? "default" : value).replaceAll("[^A-Za-z0-9_-]", "");
        return ACCOUNT_PREFIX + (safe.isEmpty() ? "default" : safe.substring(0, Math.min(48, safe.length())));
    }

    private static String bounded(String value, int length) {
        String text = value == null ? "" : value;
        return text.length() <= length ? text : text.substring(0, length);
    }

    private static String empty(String value) { return value == null ? "" : value; }

    private static void putError(JSONObject result, Exception error) {
        try { result.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage()); }
        catch (JSONException ignored) { }
    }
}
