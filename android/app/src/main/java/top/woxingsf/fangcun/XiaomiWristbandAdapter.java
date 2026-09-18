package top.woxingsf.fangcun;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.xiaomi.xms.wearable.Wearable;
import com.xiaomi.xms.wearable.auth.AuthApi;
import com.xiaomi.xms.wearable.auth.Permission;
import com.xiaomi.xms.wearable.message.MessageApi;
import com.xiaomi.xms.wearable.message.OnMessageReceivedListener;
import com.xiaomi.xms.wearable.node.DataItem;
import com.xiaomi.xms.wearable.node.Node;
import com.xiaomi.xms.wearable.node.NodeApi;
import com.xiaomi.xms.wearable.node.OnDataChangedListener;
import com.xiaomi.xms.wearable.node.DataSubscribeResult;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Xiaomi Wearable AAR adapter for the Fangcun phone-to-Vela protocol. */
public final class XiaomiWristbandAdapter implements WristbandAdapter {
    private static final String LINK_TAG = "fangcun.link.v1";
    private static final String ACK_TAG = "fangcun.link.ack";
    private static final String DEFAULT_WEAR_PACKAGE = "app.fangcun";
    // Leave room for the JSON envelope; large Vela messages are unreliable on
    // some community-tested firmware versions.
    private static final int MAX_FRAME_BYTES = 2200;
    private static final int MAX_RETRIES = 3;
    private static final long ACK_TIMEOUT_MS = 2500L;
    private static final long CONNECT_TIMEOUT_MS = 3500L;
    private static final long[] RECONNECT_DELAYS_MS = {1000L, 2000L, 4000L, 8000L, 16000L};

    private final NodeApi nodeApi;
    private final AuthApi authApi;
    private final MessageApi messageApi;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final Object transferLock = new Object();
    private final OnMessageReceivedListener messageListener = this::onMessage;
    private final OnDataChangedListener connectionListener = this::onConnectionChanged;

    private volatile Node activeNode;
    private volatile String state = STATE_DISCONNECTED;
    private volatile String lastRevision;
    private volatile PendingAck pendingAck;
    private volatile boolean listenersRegistered;
    private volatile boolean heartbeatRunning;
    private volatile boolean handshakeComplete;
    private int reconnectAttempt;

    public XiaomiWristbandAdapter(Context context) {
        Context appContext = context.getApplicationContext();
        nodeApi = Wearable.getNodeApi(appContext);
        authApi = Wearable.getAuthApi(appContext);
        messageApi = Wearable.getMessageApi(appContext);
    }

    @Override
    public JSONObject capabilities() {
        JSONObject result = base();
        try {
            result.put("available", true)
                .put("state", state)
                .put("adapter", "xiaomi-wearable-aar")
                .put("transport", "xiaomi-wearable")
                .put("supportedTransports", new String[]{"xiaomi-wearable"})
                .put("requiresPermissions", new String[]{"DEVICE_MANAGER", "NOTIFY"})
                .put("wearAppPackage", DEFAULT_WEAR_PACKAGE)
                .put("features", new JSONObject()
                    .put("nodeDiscovery", true)
                    .put("permissions", true)
                    .put("openWearApp", true)
                    .put("messageApi", true)
                    .put("handshake", true)
                    .put("heartbeat", true)
                    .put("chunking", true)
                    .put("ack", true));
        } catch (Exception ignored) {}
        return result;
    }

    @Override
    public JSONObject status() {
        JSONObject result = capabilities();
        try {
            Node node = activeNode;
            result.put("nodeId", node == null ? JSONObject.NULL : node.id)
                .put("nodeName", node == null ? JSONObject.NULL : node.name)
                .put("listenersRegistered", listenersRegistered)
                .put("lastRevision", lastRevision == null ? JSONObject.NULL : lastRevision);
        } catch (Exception ignored) {}
        return result;
    }

    @Override
    public JSONObject connect(JSONObject options) {
        CountDownLatch done = new CountDownLatch(1);
        discoverAndPrepare(true, done);
        await(done, CONNECT_TIMEOUT_MS);
        return operationResult("connect", STATE_CONNECTED.equals(state) && activeNode != null);
    }

    @Override
    public JSONObject disconnect() {
        Node node = activeNode;
        if (node != null) unregister(node);
        activeNode = null;
        listenersRegistered = false;
        heartbeatRunning = false;
        handshakeComplete = false;
        state = STATE_DISCONNECTED;
        return operationResult("disconnect", true);
    }

    @Override
    public JSONObject openApp(JSONObject options) {
        Node node = activeNode;
        if (node == null) {
            CountDownLatch ready = new CountDownLatch(1);
            discoverAndPrepare(false, ready);
            await(ready, CONNECT_TIMEOUT_MS);
            node = activeNode;
        }
        if (node == null) return operationResult("openApp", false, "not_connected");
        String packageName = options == null ? DEFAULT_WEAR_PACKAGE : options.optString("package", DEFAULT_WEAR_PACKAGE);
        try {
            nodeApi.launchWearApp(node.id, packageName)
                .addOnSuccessListener(ignored -> {})
                .addOnFailureListener(ignored -> {});
            return operationResult("openApp", true);
        } catch (Exception error) {
            return operationResult("openApp", false, "launch_failed");
        }
    }

    @Override
    public JSONObject sync(JSONObject payload) {
        Node node = activeNode;
        if (node == null || !listenersRegistered) {
            CountDownLatch ready = new CountDownLatch(1);
            discoverAndPrepare(false, ready);
            await(ready, CONNECT_TIMEOUT_MS);
            node = activeNode;
        }
        if (node == null || !listenersRegistered) return operationResult("sync", false, "not_connected");

        String data = payload == null ? "{}" : payload.toString();
        String transferId = UUID.randomUUID().toString();
        byte[][] frames = buildFrames(data, transferId);
        synchronized (transferLock) {
            if (!handshakeComplete
                && !sendTransfer(node.id, "{\"type\":\"handshake\",\"protocol\":\"fangcun.link.v1\"}", true)) {
                return operationResult("sync", false, "handshake_failed");
            }
            handshakeComplete = true;
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                PendingAck ack = new PendingAck(transferId);
                pendingAck = ack;
                boolean sent = sendFrames(node.id, frames);
                boolean acknowledged = sent && ack.await(ACK_TIMEOUT_MS);
                pendingAck = null;
                if (acknowledged && ack.ok) {
                    lastRevision = ack.revision;
                    JSONObject result = operationResult("sync", true);
                    try {
                        result.put("transferId", transferId).put("attempts", attempt)
                            .put("revision", ack.revision == null ? JSONObject.NULL : ack.revision);
                    } catch (Exception ignored) {}
                    return result;
                }
            }
        }
        return operationResult("sync", false, "ack_timeout");
    }

    private void discoverAndPrepare(boolean requestPermission, CountDownLatch done) {
        state = STATE_CONNECTING;
        nodeApi.getConnectedNodes()
            .addOnSuccessListener(nodes -> chooseNode(nodes, requestPermission, done))
            .addOnFailureListener(error -> finishDiscovery(done));
    }

    private void chooseNode(List<Node> nodes, boolean requestPermission, CountDownLatch done) {
        Node node = nodes == null || nodes.isEmpty() ? null : nodes.get(0);
        if (node == null) { activeNode = null; state = STATE_DISCONNECTED; finishDiscovery(done); return; }
        Node previous = activeNode;
        if (previous != null && !previous.id.equals(node.id)) unregister(previous);
        activeNode = node;
        nodeApi.isWearAppInstalled(node.id)
            .addOnSuccessListener(installed -> {
                if (!installed) { state = STATE_ERROR; finishDiscovery(done); return; }
                checkPermissions(node, requestPermission, done);
            })
            .addOnFailureListener(error -> { state = STATE_ERROR; finishDiscovery(done); });
    }

    private void checkPermissions(Node node, boolean requestPermission, CountDownLatch done) {
        Permission[] required = new Permission[]{Permission.DEVICE_MANAGER, Permission.NOTIFY};
        authApi.checkPermissions(node.id, required)
            .addOnSuccessListener(granted -> {
                boolean allGranted = granted != null && granted.length == required.length;
                if (allGranted) for (boolean value : granted) allGranted &= value;
                if (allGranted) register(node, done);
                else if (requestPermission) {
                    authApi.requestPermission(node.id, required)
                        .addOnSuccessListener(ignored -> register(node, done))
                        .addOnFailureListener(error -> { state = STATE_ERROR; finishDiscovery(done); });
                } else { state = STATE_DISCONNECTED; finishDiscovery(done); }
            })
            .addOnFailureListener(error -> { state = STATE_ERROR; finishDiscovery(done); });
    }

    private void register(Node node, CountDownLatch done) {
        if (listenersRegistered) { state = STATE_CONNECTED; startHeartbeat(); finishDiscovery(done); return; }
        messageApi.addListener(node.id, messageListener)
            .addOnSuccessListener(ignored -> nodeApi.subscribe(node.id, DataItem.ITEM_CONNECTION, connectionListener)
                .addOnSuccessListener(ignored2 -> {
                    listenersRegistered = true;
                        state = STATE_CONNECTED;
                        reconnectAttempt = 0;
                        handshakeComplete = false;
                        startHeartbeat();
                        startHandshake(node);
                        finishDiscovery(done);
                })
                .addOnFailureListener(error -> { state = STATE_ERROR; finishDiscovery(done); }))
            .addOnFailureListener(error -> { state = STATE_ERROR; finishDiscovery(done); });
    }

    private void startHeartbeat() {
        if (heartbeatRunning) return;
        heartbeatRunning = true;
        worker.scheduleWithFixedDelay(() -> {
            Node node = activeNode;
            if (!heartbeatRunning || node == null || !listenersRegistered) return;
            synchronized (transferLock) { sendTransfer(node.id, "{\"type\":\"heartbeat\"}", true); }
        }, 15, 15, TimeUnit.SECONDS);
    }

    private void startHandshake(Node node) {
        worker.execute(() -> {
            synchronized (transferLock) {
                boolean ok = sendTransfer(node.id, "{\"type\":\"handshake\",\"protocol\":\"fangcun.link.v1\"}", true);
                if (ok) handshakeComplete = true;
                if (!ok && activeNode != null && activeNode.id.equals(node.id)) scheduleReconnect();
            }
        });
    }

    private void onConnectionChanged(String nodeId, DataItem item, DataSubscribeResult result) {
        Node node = activeNode;
        if (node == null || !node.id.equals(nodeId)) return;
        if (result != null && result.getConnectedStatus() == DataSubscribeResult.RESULT_CONNECTION_CONNECTED) {
            state = STATE_CONNECTED;
            reconnectAttempt = 0;
        } else {
            state = STATE_DISCONNECTED;
            listenersRegistered = false;
            scheduleReconnect();
        }
    }

    private void scheduleReconnect() {
        int attempt = Math.min(reconnectAttempt++, RECONNECT_DELAYS_MS.length - 1);
        mainHandler.postDelayed(() -> discoverAndPrepare(false, null), RECONNECT_DELAYS_MS[attempt]);
    }

    private void onMessage(String nodeId, byte[] bytes) {
        Node node = activeNode;
        if (node == null || !node.id.equals(nodeId) || bytes == null) return;
        try {
            JSONObject message = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            if (!ACK_TAG.equals(message.optString("tag"))) return;
            PendingAck ack = pendingAck;
            if (ack == null || !ack.transferId.equals(message.optString("transferId"))) return;
            ack.ok = message.optBoolean("ok", false);
            ack.revision = message.optString("revision", null);
            ack.latch.countDown();
        } catch (Exception ignored) {}
    }

    private boolean sendTransfer(String nodeId, String data, boolean requireAck) {
        String transferId = UUID.randomUUID().toString();
        byte[][] frames = buildFrames(data, transferId);
        for (int attempt = 0; attempt < (requireAck ? MAX_RETRIES : 1); attempt++) {
            PendingAck ack = requireAck ? new PendingAck(transferId) : null;
            pendingAck = ack;
            boolean sent = sendFrames(nodeId, frames);
            if (!requireAck) {
                pendingAck = null;
                return sent;
            }
            boolean acknowledged = sent && ack.await(ACK_TIMEOUT_MS);
            pendingAck = null;
            if (acknowledged && ack.ok) return true;
        }
        return false;
    }

    private boolean sendFrames(String nodeId, byte[][] frames) {
        try {
            for (byte[] frame : frames) messageApi.sendMessage(nodeId, frame);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private static byte[][] buildFrames(String data, String transferId) {
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= MAX_FRAME_BYTES) return new byte[][]{envelope("snapshot", transferId, 0, 1, data)};
        java.util.ArrayList<String> pieces = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        int currentBytes = 0;
        for (int offset = 0; offset < data.length();) {
            int codePoint = data.codePointAt(offset);
            String part = new String(Character.toChars(codePoint));
            int partBytes = part.getBytes(StandardCharsets.UTF_8).length;
            if (current.length() > 0 && currentBytes + partBytes > MAX_FRAME_BYTES) {
                pieces.add(current.toString());
                current.setLength(0);
                currentBytes = 0;
            }
            current.append(part);
            currentBytes += partBytes;
            offset += Character.charCount(codePoint);
        }
        if (current.length() > 0) pieces.add(current.toString());
        byte[][] frames = new byte[pieces.size()][];
        for (int index = 0; index < pieces.size(); index++) {
            frames[index] = envelope("chunk", transferId, index, pieces.size(), pieces.get(index));
        }
        return frames;
    }

    private static byte[] envelope(String kind, String transferId, int index, int total, String data) {
        JSONObject message = new JSONObject();
        try {
            message.put("tag", LINK_TAG).put("kind", kind).put("transferId", transferId)
                .put("index", index).put("total", total).put("data", data);
        } catch (Exception ignored) {}
        return message.toString().getBytes(StandardCharsets.UTF_8);
    }

    private void unregister(Node node) {
        try { messageApi.removeListener(node.id); } catch (Exception ignored) {}
        try { nodeApi.unsubscribe(node.id, DataItem.ITEM_CONNECTION); } catch (Exception ignored) {}
        listenersRegistered = false;
    }

    private void finishDiscovery(CountDownLatch done) { if (done != null) done.countDown(); }

    private static void await(CountDownLatch latch, long timeoutMs) {
        try { latch.await(timeoutMs, TimeUnit.MILLISECONDS); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private JSONObject base() {
        JSONObject value = new JSONObject();
        try { value.put("api", API).put("adapter", "xiaomi-wearable-aar"); }
        catch (Exception ignored) {}
        return value;
    }

    private JSONObject operationResult(String operation, boolean ok) {
        return operationResult(operation, ok, ok ? null : "operation_failed");
    }

    private JSONObject operationResult(String operation, boolean ok, String error) {
        JSONObject result = base();
        try {
            result.put("ok", ok).put("operation", operation).put("state", state);
            if (error != null) result.put("error", error);
        } catch (Exception ignored) {}
        return result;
    }

    private static final class PendingAck {
        final String transferId;
        final CountDownLatch latch = new CountDownLatch(1);
        volatile boolean ok;
        volatile String revision;

        PendingAck(String transferId) { this.transferId = transferId; }
        boolean await(long timeoutMs) {
            try { latch.await(timeoutMs, TimeUnit.MILLISECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            return latch.getCount() == 0;
        }
    }
}
