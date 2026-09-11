// Optional real-browser suite. Uses an existing Playwright install, with no npm dependency changes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    const file = path.join(root, name === "/" ? "index.html" : name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".woff2") ? "font/woff2" : "text/html");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let revision = 0, remote = null, puts = 0, holdUpload = null, failData = false, failProvider = false, holdProvider = null;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      let result = {};
      if (url.pathname === "/api/auth/session") result = { configured: true, authenticated: true, user: { id: 7, username: "member-test", role: "user" }, version: "2.7.0" };
      else if (/\/integrations\/(google|outlook)\/status$/.test(url.pathname)) result = { configured: true, connected: true, account: "member-test", lastSyncAt: new Date().toISOString() };
      else if (/\/integrations\/(google|outlook)\/sync$/.test(url.pathname)) {
        if (holdProvider) await holdProvider;
        if (failProvider) { await route.fulfill({ status: 503, json: { error: "测试：外部日历暂不可用" } }); return; }
        result = { stats: { pushed: 2, pulled: 1, imported: 0 } };
      }
      else if (url.pathname === "/api/data") {
        if (failData) { await route.fulfill({ status: 503, json: { error: "测试：网络暂不可用" } }); return; }
        if (route.request().method() === "PUT") {
          remote = route.request().postDataJSON().data; revision++; puts++;
          if (holdUpload) await holdUpload;
        }
        result = { data: remote, revision, updatedAt: new Date().toISOString() };
      }
      await route.fulfill({ json: result });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelector("#authGate").classList.contains("hidden"));
    await page.waitForFunction(() => !syncState.syncing && !syncState.reconciling);

    for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 1024, height: 450 }]) {
      await page.setViewportSize(size);
      await page.locator("#mobileMenu").click();
      await page.locator("#cloudBtn").click();
      assert.equal(await page.locator("#cloudModal").evaluate((el) => el.open), true);
      if (process.env.FANGCUN_QA_OUTPUT) {
        const directory = path.resolve(root, "release", "qa");
        fs.mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: path.join(directory, `sync-${size.width}x${size.height}.png`) });
      }
      await page.locator("#syncNowBtn").click();
      await page.waitForFunction(() => !document.querySelector("#syncNowBtn").disabled);
      await page.locator('#cloudModal .close-button').click();
      await page.locator("#mobileMenu").click();
      await page.locator("#cloudBtn").click();
      await page.locator('[data-sync-tab="files"]').click();
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#exportBtn").click();
      const download = await downloadPromise;
      const filename = await download.path();
      const exported = JSON.parse(fs.readFileSync(filename, "utf8"));
      assert.ok(Array.isArray(exported.tasks));
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.locator("#importInput").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
      await page.locator('#cloudModal .close-button').click();
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { switchView("schedule"); });
    await page.locator(".landscape-schedule-menu summary").click();
    await page.locator('[data-landscape-schedule-action="import"]').click();
    assert.equal(await page.locator("#cloudModal").evaluate((el) => el.open), true);
    assert.equal(await page.locator('[data-sync-tab="calendar"]').getAttribute("aria-selected"), "true");
    for (const provider of ["Outlook", "Google"]) {
      await page.locator('#sync' + provider + 'Btn').click();
      await page.waitForFunction((id) => document.querySelector(id).textContent.includes("同步完成"), '#' + provider.toLowerCase() + 'SyncDetail');
      assert.equal(await page.locator('#' + provider.toLowerCase() + 'SyncDetail').isVisible(), true);
    }
    failProvider = true;
    await page.locator("#syncGoogleBtn").click();
    await page.waitForFunction(() => document.querySelector("#googleSyncDetail").textContent.includes("外部日历暂不可用"));
    assert.equal(await page.locator("#syncGoogleBtn").isEnabled(), true);
    failProvider = false;
    if (process.env.FANGCUN_QA_OUTPUT) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(root, "release", "qa", "external-calendar-portrait.png") });
      await page.setViewportSize({ width: 844, height: 390 });
    }
    await page.locator('#cloudModal .close-button').click();

    await page.locator('[data-schedule-mode="week"]').click();
    const canvas = await page.locator(".schedule-board-wrap").boundingBox();
    assert.ok(canvas.height >= 390 * 0.75, "横屏日历画布至少占屏幕四分之三");
    const menuBox = await page.locator("#mobileMenu").boundingBox();
    assert.equal(menuBox.width, menuBox.height, "菜单按钮必须为正圆");
    await page.locator("#calendarZoomFit").click();
    assert.equal(await page.locator(".schedule-board-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "适宽后整周不应超出画布宽度");
    const zoom = await page.evaluate(() => calendarZoomValue());
    await page.locator("#calendarZoomOut").click();
    assert.ok(await page.evaluate(() => calendarZoomValue()) < zoom);
    await page.locator("#calendarZoomIn").click();
    const beforePinch = await page.evaluate(() => calendarZoomValue());
    await page.evaluate(() => {
      const board = document.querySelector(".schedule-board-wrap");
      const touches = (spread) => [new Touch({ identifier: 1, target: board, clientX: 240 - spread, clientY: 180 }), new Touch({ identifier: 2, target: board, clientX: 240 + spread, clientY: 220 })];
      board.dispatchEvent(new TouchEvent("touchstart", { touches: touches(40), bubbles: true, cancelable: true }));
      board.dispatchEvent(new TouchEvent("touchmove", { touches: touches(55), bubbles: true, cancelable: true }));
      board.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
    });
    assert.ok(await page.evaluate(() => calendarZoomValue()) > beforePinch, "双指手势应改变日历缩放");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#calendarZoomFit").click();
    assert.equal(await page.locator(".schedule-board-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "竖屏适宽也应显示完整七天");
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator("#calendarZoomFit").click();
    await page.evaluate(() => {
      const yesterday = localISO(addDays(new Date(), -1));
      data.tasks.unshift({ id: "past-event", title: "过去的测试日程", startDate: yesterday, startTime: "09:00", endDate: yesterday, endTime: "10:00", type: "event", completed: false });
      displayedWeek = currentSemesterWeek(dateFromISO(yesterday));
      renderAll();
    });
    assert.equal(await page.locator('.calendar-week-event[data-task-id="past-event"]').evaluate((el) => el.classList.contains("past")), true);
    if (process.env.FANGCUN_QA_OUTPUT) await page.screenshot({ path: path.join(root, "release", "qa", "calendar-landscape.png") });
    await page.evaluate(() => { document.documentElement.style.setProperty("--native-safe-top", "24px"); document.documentElement.style.setProperty("--native-safe-bottom", "16px"); });
    await page.locator(".landscape-schedule-menu summary").click();
    await page.locator('[data-landscape-schedule-action="settings"]').click();
    await page.locator('#semesterForm button[type="submit"]').scrollIntoViewIfNeeded();
    const cancelBox = await page.locator('[data-close-dialog="semesterModal"]').last().boundingBox();
    const saveBox = await page.locator('#semesterForm button[type="submit"]').boundingBox();
    assert.ok(Math.abs(cancelBox.y - saveBox.y) < 2, "取消和保存应排在同一行");
    assert.ok(saveBox.y + saveBox.height < 390 - 16, "操作按钮不得覆盖系统底部手势区");
    if (process.env.FANGCUN_QA_OUTPUT) await page.screenshot({ path: path.join(root, "release", "qa", "semester-footer.png") });
    await page.locator('#semesterModal .close-button').click();
    await page.evaluate(() => { document.documentElement.style.removeProperty("--native-safe-top"); document.documentElement.style.removeProperty("--native-safe-bottom"); });

    await page.evaluate(() => {
      for (let i = 0; i < 6; i++) data.tasks.unshift({ id: "complete-test-" + i, title: "连续完成 " + i, type: "task", quadrant: "q1", completed: false });
      switchView("matrix"); renderAll();
      bindDynamicEvents(); bindDynamicEvents();
      const staleButton = document.querySelector('#q1List [data-complete-id="complete-test-5"]');
      staleButton.click(); staleButton.click();
    });
    for (let i = 4; i >= 0; i--) await page.locator('#q1List [data-complete-id="complete-test-' + i + '"]').click();
    assert.equal(await page.evaluate(() => data.tasks.filter((task) => task.id.startsWith("complete-test-") && task.completed).length), 6, "连续点击和旧节点重复点击不能把已完成事项恢复");

    await page.waitForFunction(() => !syncState.syncing && !syncState.reconciling && !syncMeta().dirty);
    await page.evaluate(() => openDataHub("calendar"));
    let releaseProvider;
    holdProvider = new Promise((resolve) => { releaseProvider = resolve; });
    await page.locator("#syncOutlookBtn").click();
    await page.waitForFunction(() => syncState.integrationSyncing);
    assert.equal(await page.locator("#syncOutlookBtn").textContent(), "同步中…");
    await page.evaluate(() => { data.tasks[0].notes = "外部同步期间继续修改"; saveData(); });
    releaseProvider(); holdProvider = null;
    await page.waitForFunction(() => !syncState.integrationSyncing);
    assert.equal(await page.evaluate(() => data.tasks[0].notes), "外部同步期间继续修改");
    assert.equal(await page.evaluate(() => syncState.conflict), true);
    await page.evaluate(() => syncToCloud(true));
    await page.locator('#cloudModal .close-button').click();

    await page.evaluate(() => {
      $("#quickInput").value = "明天下午到图书馆复习3.5版本报告，补充三点建议";
      submitQuickTask({ preventDefault() {} });
    });
    const titleInput = page.locator('[data-smart-field="title"]');
    assert.match(await titleInput.inputValue(), /3.5版本报告，补充三点建议/);
    await titleInput.fill("修订后的完整标题");
    // Blur immediately into submit: previous implementation rebuilt DOM and lost this click.
    await page.locator('#smartCaptureForm button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector("#smartCaptureModal").open);
    const saved = await page.evaluate(() => data.tasks[0]);
    assert.equal(saved.title, "修订后的完整标题");
    assert.match(saved.notes, /原始输入：明天下午到图书馆复习3.5版本报告/);
    assert.equal(saved.dueTime, "15:00");

    await page.waitForFunction(() => !syncState.syncing && !syncState.reconciling);
    let releaseUpload;
    holdUpload = new Promise((resolve) => { releaseUpload = resolve; });
    const before = puts;
    await page.evaluate(() => { clearTimeout(syncTimer); data.tasks[0].title = "第一版"; syncToCloud(); });
    await page.waitForFunction(() => syncState.syncing);
    await page.evaluate(() => { data.tasks[0].title = "上传中继续修改"; saveData(); });
    releaseUpload(); holdUpload = null;
    await page.waitForFunction(() => !syncState.syncing && !syncMeta().dirty);
    assert.ok(puts >= before + 2, "上传中继续编辑必须补传");
    assert.equal(remote.tasks[0].title, "上传中继续修改");

    failData = true;
    await page.evaluate(() => syncNow());
    assert.match(await page.evaluate(() => syncState.lastError), /网络暂不可用/);
    assert.equal(await page.locator("#syncNowBtn").isEnabled(), true);
    failData = false;
    await page.evaluate(() => syncNow());
    assert.equal(await page.evaluate(() => syncState.lastError), "");

    const restoredBackup = await page.evaluate(() => JSON.parse(JSON.stringify(data)));
    restoredBackup.tasks[0].title = "从备份恢复的标题";
    const putsBeforeRestore = puts;
    await page.locator("#mobileMenu").click();
    await page.locator("#cloudBtn").click();
    await page.locator('[data-sync-tab="files"]').click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#importInput").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(restoredBackup)) });
    await page.waitForFunction(() => data.tasks[0].title === "从备份恢复的标题");
    await page.evaluate(() => syncNow());
    assert.equal(puts, putsBeforeRestore, "恢复备份后不能绕过选版确认自动覆盖云端");
    assert.equal(await page.evaluate(() => syncState.conflict), true);
    const previous = await page.evaluate(() => JSON.parse(localStorage.getItem(accountKey(PRE_CLOUD_BACKUP_KEY))));
    assert.equal(previous.data.tasks[0].title, "上传中继续修改");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#authGate").classList.contains("hidden"));
    assert.equal(await page.evaluate(() => syncState.conflict), true);
    assert.equal(puts, putsBeforeRestore, "关闭再打开后仍必须保留恢复备份的选版保护");
    assert.deepEqual(errors, []);
    console.log("真实浏览器交互通过：3 种触控尺寸、紧凑日历/缩放/过去变暗、安全区按钮对齐、统一同步入口、外部日历进度/失败/本机修改保护、连续完成/重复事件、备份恢复保护与识别立即提交。");
    await context.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
