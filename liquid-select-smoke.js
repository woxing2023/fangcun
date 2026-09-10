// FANGCUN_PLAYWRIGHT_MODULE=/path/to/playwright node liquid-select-smoke.js
const assert = require('node:assert/strict');
const { chromium } = require(process.env.FANGCUN_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<html data-skin="liquid"><style>
      .liquid-select-native{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
      .liquid-select-menu{position:fixed;inset:auto;margin:0;overflow:auto}
      .liquid-select-menu[hidden]{display:none}
      .liquid-select-trigger{height:40px;min-width:200px}
    </style><body><form id="form"><label>课程<select id="course" name="course" required>
      <option value="">请选择</option><option value="a">Alpha</option><option value="b">Beta</option><option value="c" disabled>Charlie</option><option value="d">Delta</option>
    </select></label><button id="after" type="button">后续</button></form>
    <dialog id="dialog"><label>弹窗<select id="modal"><option>A</option><option>B</option></select></label></dialog></body></html>`);
    await page.addScriptTag({ path: require('node:path').join(__dirname, 'liquid-select.js') });
    const trigger = page.locator('#course + .liquid-select-trigger');
    await trigger.waitFor();
    assert.equal(await trigger.getAttribute('aria-label'), '课程');
    await page.evaluate(() => {
      window.events = [];
      for (const type of ['input', 'change']) course.addEventListener(type, event => events.push(event.type));
    });
    await trigger.click();
    await trigger.press('ArrowDown');
    await trigger.press('Enter');
    assert.equal(await page.locator('#course').inputValue(), 'a');
    assert.deepEqual(await page.evaluate(() => events), ['input', 'change']);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await trigger.press('End');
    await trigger.press('Enter');
    assert.equal(await page.locator('#course').inputValue(), 'd');
    await trigger.press('Home');
    await trigger.press('ArrowDown');
    await trigger.press('ArrowDown');
    await trigger.press('ArrowDown');
    await trigger.press('Enter');
    assert.equal(await page.locator('#course').inputValue(), 'd', 'arrows skip disabled options');
    await trigger.press('b');
    await trigger.press('Enter');
    assert.equal(await page.locator('#course').inputValue(), 'b', 'typeahead followed by Enter commits');
    await trigger.click();
    await trigger.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await trigger.click();
    await trigger.press('Tab');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'after');
    await page.evaluate(() => { course.value = 'd'; });
    await page.waitForFunction(() => document.querySelector('#course + button').textContent === 'Delta');
    await page.evaluate(() => form.reset());
    await page.waitForFunction(() => document.querySelector('#course + button').textContent === '请选择');
    assert.equal(await page.evaluate(() => form.reportValidity()), false);
    assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
    await page.evaluate(() => { course.add(new Option('Echo', 'e')); course.value = 'e'; });
    await page.waitForFunction(() => document.querySelector('#course + button').textContent === 'Echo');
    await page.evaluate(() => { course.disabled = true; });
    await page.waitForFunction(() => document.querySelector('#course + button').disabled);
    await page.evaluate(() => { course.disabled = false; course.options[5].textContent = 'Echo revised'; });
    await page.waitForFunction(() => document.querySelector('#course + button').textContent === 'Echo revised');
    assert.equal(await page.evaluate(() => new FormData(form).get('course')), 'e');
    await page.evaluate(() => dialog.showModal());
    await page.locator('#modal + button').click();
    assert.equal(await page.locator('#dialog .liquid-select-menu').evaluate(node => node.matches(':popover-open')), true);
    await page.locator('#modal + button').press('Escape');
    assert.equal(await page.locator('#dialog').evaluate(node => node.open), true, 'Escape closes list, retains dialog');
    await page.evaluate(() => { dialog.close(); document.documentElement.dataset.skin = 'classic'; });
    await page.waitForFunction(() => !document.querySelector('.liquid-select-trigger'));
    assert.equal(await page.locator('#course').getAttribute('aria-hidden'), null);
    assert.equal(await page.locator('#course').getAttribute('tabindex'), null);
    assert.equal(await page.locator('.liquid-select-menu').count(), 0);
    assert.equal(await page.locator('#course').inputValue(), 'e');
    await page.evaluate(() => { document.documentElement.dataset.skin = 'liquid'; });
    await trigger.waitFor();
    await page.evaluate(() => { const select = document.createElement('select'); select.id = 'dynamic'; select.add(new Option('Dynamic')); form.append(select); });
    await page.locator('#dynamic + .liquid-select-trigger').waitFor();
    await page.evaluate(() => document.getElementById('dynamic').remove());
    await page.waitForFunction(() => document.querySelectorAll('.liquid-select-trigger').length === 2);
    await page.evaluate(() => { course.multiple = true; });
    await page.waitForFunction(() => !document.querySelector('#course + .liquid-select-trigger'));
    await page.evaluate(() => { course.multiple = false; });
    await trigger.waitFor();
    await page.evaluate(() => { document.documentElement.dataset.skin = 'classic'; });
    await page.waitForFunction(() => !document.querySelector('.liquid-select-trigger'));
    await page.evaluate(() => {
      HTMLElement.prototype.showPopover = undefined;
      HTMLElement.prototype.hidePopover = undefined;
      document.documentElement.dataset.skin = 'liquid';
    });
    await trigger.waitFor();
    await trigger.click();
    assert.equal(await page.locator('body > .liquid-select-menu').isVisible(), true, 'fixed fallback remains operable without Popover API');
    await trigger.press('Escape');
    assert.deepEqual(errors, []);
    console.log('liquid select smoke passed: keyboard, typeahead, events, values, reset, options, validation, dialog, skin cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
