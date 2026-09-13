// Optional browser regression for real mobile calendar geometry and complete reading.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.join(__dirname, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".woff2") ? "font/woff2" : "text/html");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ json: pathname === "/api/auth/session" ? { configured: true, authenticated: true, user: { id: 7, username: "member-calendar", role: "user" } } : pathname === "/api/data" ? { data: null, revision: 0 } : {} });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.waitForFunction(() => document.querySelector("#authGate").classList.contains("hidden"));
    await page.waitForFunction(() => !syncState.syncing && !syncState.reconciling);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('link[href^="mobile-calendar.css"]').count(), 1, "日历布局必须随页面加载");
    await page.evaluate(() => {
      data.semester = defaultSemester(); data.timeSlots = defaultTimeSlots(); data.courses = []; data.tasks = [];
      data.calendarRules = []; data.courseExceptions = [];
      const titles = ["计算机和程序设计基础 Lab 2 - Python as a Calculator", "线性代数与空间解析几何", "大学物理实验与数据分析"];
      const colors = ["#536db3", "#3d8d83", "#a56d47", "#8d65a1"];
      for (let day = 1; day <= 7; day++) for (let slot = 0; slot < 3; slot++) {
        data.courses.push({ id: `calendar-${day}-${slot}`, name: titles[slot], day, startSection: [1, 6, 11][slot], endSection: [2, 7, 13][slot], weeks: [1], color: colors[(day + slot) % colors.length], location: `B12-${200 + day}`, teacher: "任课老师", reminderMinutes: 10 });
      }
      const start = weekStartDate(1);
      data.tasks.push({ id: "calendar-early", title: "清晨完整显示测试", startDate: localISO(start), startTime: "06:30", endTime: "07:00", type: "event", completed: false });
      data.tasks.push({ id: "calendar-late", title: "深夜提交截止的完整名称", due: localISO(addDays(start, 6)), dueTime: "23:59", type: "task", completed: false });
      for (let index = 0; index < 5; index++) data.tasks.push({ id: "calendar-all-" + index, title: "全天事项完整名称 " + index, startDate: localISO(start), type: "event", completed: false });
      displayedWeek = 1; scheduleMode = "week"; localStorage.setItem(accountKey("fangcun-calendar-layout"), "overview"); switchView("schedule"); renderAll();
    });
    for (const appearance of [{ skin: "classic", dark: false }, { skin: "liquid", dark: true }]) {
      await page.evaluate(({ skin, dark }) => { document.documentElement.dataset.skin = skin; document.body.classList.toggle("dark", dark); }, appearance);
      for (const mode of ["week", "timetable"]) {
        await page.locator(`[data-schedule-mode="${mode}"]`).click();
        await page.locator("#calendarZoomFit").click();
        for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 568, height: 320 }, { width: 430, height: 932 }, { width: 1024, height: 450 }]) {
          await page.setViewportSize(size);
          await page.waitForTimeout(100);
          const metrics = await page.evaluate((mode) => {
            const wrap = document.querySelector(".schedule-board-wrap");
            const grid = document.querySelector(mode === "week" ? ".calendar-week-grid" : "#scheduleBoard");
            const outer = wrap.getBoundingClientRect();
            const bounds = grid.getBoundingClientRect();
            const items = [...grid.querySelectorAll(mode === "week" ? ".calendar-week-event" : ".course-block")];
            const toolbar = document.querySelector(".week-toolbar");
            const tabs = document.querySelector(".view-switch").getBoundingClientRect();
            const zoom = document.querySelector(".calendar-zoom-tools").getBoundingClientRect();
            const list = document.querySelector("#calendarListBtn").getBoundingClientRect();
            return { width: wrap.clientWidth, height: wrap.clientHeight, scrollWidth: wrap.scrollWidth, scrollHeight: wrap.scrollHeight, layout: wrap.dataset.calendarLayout, canvasBottom: outer.bottom, gridBottom: bounds.bottom, gridRight: bounds.right, canvasRight: outer.right, toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth + 1, controls: { tabsBottom: tabs.bottom, zoomTop: zoom.top, listTop: list.top }, items: items.length, clipped: items.filter((item) => { const r = item.getBoundingClientRect(); return r.left < outer.left - 1 || r.top < outer.top - 1 || r.right > outer.right + 1 || r.bottom > outer.bottom + 1; }).map((item) => item.getAttribute("aria-label")), names: items.every((item) => !!item.getAttribute("aria-label")), pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
          }, mode);
          const label = `${appearance.skin} ${mode} ${size.width}×${size.height}`;
          assert.equal(metrics.layout, "overview", label + " 旋转后应保留全表");
          assert.ok(metrics.scrollWidth <= metrics.width + 1, label + " 所有日期应落在屏内: " + JSON.stringify(metrics));
          assert.ok(metrics.scrollHeight <= metrics.height + 1, label + " 所有时段应落在屏内: " + JSON.stringify(metrics));
          assert.ok(Math.abs(metrics.gridBottom - metrics.canvasBottom) <= 2, label + " 应使用完整可用高度");
          assert.deepEqual(metrics.clipped, [], label + " 不应裁掉课程或最早/最晚事项");
          assert.equal(metrics.toolbarOverflow, false, label + " 选择栏不应超宽");
          assert.equal(metrics.pageOverflow, false, label + " 页面不应横向溢出");
          if (size.height > size.width) {
            assert.ok(metrics.controls.zoomTop >= metrics.controls.tabsBottom, label + " 视图切换与缩放应分行");
            assert.ok(Math.abs(metrics.controls.zoomTop - metrics.controls.listTop) < 2, label + " 全表与清单应在同一行");
          }
          assert.equal(metrics.names, true, label + " 课程应提供完整可访问名称");
          assert.equal(metrics.items, mode === "week" ? 23 : 21, label + " 不可丢失全天范围外事项或周末课程");
          report.push({ ...appearance, mode, ...size, ...metrics });
          if (process.env.FANGCUN_QA_OUTPUT && [390, 844].includes(size.width)) {
            const directory = path.join(__dirname, "release", "qa"); fs.mkdirSync(directory, { recursive: true });
            await page.screenshot({ path: path.join(directory, `calendar-${mode}-${size.width}-${appearance.skin}-${appearance.dark ? "dark" : "light"}.png`) });
          }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator("#calendarListBtn").click();
        assert.equal(await page.locator("#calendarListBtn").getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator(".calendar-list-item").count(), mode === "week" ? 28 : 21, "清单应列出全部事项而不是前三项");
        const readable = await page.locator(".calendar-list-item strong").evaluateAll((items) => items.every((item) => item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1 && getComputedStyle(item).whiteSpace === "normal"));
        assert.equal(readable, true, "长课程名必须完整换行可读");
        const type = await page.locator('.calendar-list-item strong').first().evaluate(item => ({family:getComputedStyle(item).fontFamily,weight:getComputedStyle(item).fontWeight}));
        assert.match(type.family, /Fangcun UI/, "课表清单必须使用与正文一致的字体");
        assert.equal(type.weight, "550", "课程名称使用适中的字重");
        if (process.env.FANGCUN_QA_OUTPUT) await page.screenshot({ path: path.join(__dirname, "release", "qa", `calendar-list-${mode}-${appearance.skin}.png`) });
        await page.locator('.calendar-list-item[data-course-id="calendar-1-0"]').click();
        assert.equal(await page.locator("#courseModal").evaluate((element) => element.open), true, "清单课程应打开原有详情");
        await page.locator("#courseModal .close-button").click();
        await page.locator("#calendarZoomFit").click();
        await page.locator("#calendarZoomIn").click();
        assert.equal(await page.locator(".schedule-board-wrap").getAttribute("data-calendar-layout"), "detail", "放大应恢复自由阅读");
        await page.locator("#calendarZoomFit").click();
      }
    }
    // Native safe areas must resize the actual canvas without requiring another fit tap.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { document.documentElement.style.setProperty("--native-safe-top", "24px"); document.documentElement.style.setProperty("--native-safe-bottom", "16px"); document.documentElement.style.setProperty("--native-safe-left", "30px"); });
    await page.waitForTimeout(100);
    const safe = await page.locator(".schedule-board-wrap").evaluate((wrap) => ({ bottom: wrap.getBoundingClientRect().bottom, left: wrap.getBoundingClientRect().left, fits: wrap.scrollHeight <= wrap.clientHeight + 1 }));
    assert.ok(safe.bottom <= 390 - 16 + 1 && safe.left >= 30 && safe.fits, "原生安全区变化后全表仍需完整避让");
    assert.deepEqual(errors, []);
    if (process.env.FANGCUN_QA_OUTPUT) fs.writeFileSync(path.join(__dirname, "release", "qa", "calendar-mobile-report.json"), JSON.stringify({ passed: true, scenarios: report, safe }, null, 2) + "\n");
    console.log("手机日历浏览器检查通过：24组横竖屏/明暗/周历课表全表，旋转自动适配、早晚事项、完整名称清单、详情、放大与原生安全区。");
    await context.close();
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
