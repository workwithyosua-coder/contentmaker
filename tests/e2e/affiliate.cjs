// Browser test of the affiliate engine UI (PR #72) at desktop width and on a 390 px phone, dark theme, reduced motion:
// Schedule (Affiliate Product Bank add / edit / pause / delete, a queued Affiliate Debate slot's product, the
// "Affiliate Debate" slot format), the episode's Affiliate Hand-Off (Copy pinned comment) and /insights (Log affiliate
// orders). Checks Empty / Loading / Saved / Error states, 44 px targets, no horizontal overflow, Tab / Escape.
// Needs the app on PORT (default 3007) with APP_PASSWORD, DATABASE_URL, and migration 022 applied.
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

/** No horizontal overflow; every visible control in `scope` at least 44 px tall (buttons also 44 px wide); no em dash. */
async function audit(page, label, scope) {
  const r = await page.evaluate((scope) => {
    const roots = [...document.querySelectorAll(scope)];
    const small = [];
    for (const root of roots)
      for (const el of root.querySelectorAll('button, a, input:not([type=hidden]), select, textarea, summary')) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        if (b.height < 44 || (el.tagName === 'BUTTON' && b.width < 44)) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, small, emDash: roots.some((x) => /—/.test(x.innerText)), n: roots.length };
  }, scope);
  check(`${label}: no horizontal overflow`, r.overflow <= 0, `${r.overflow}px`);
  check(`${label}: controls are at least 44 px`, r.n > 0 && r.small.length === 0, r.small.slice(0, 4).join('; '));
  check(`${label}: no em dashes`, !r.emDash);
}

(async () => {
  // a clean slate: no products, no conversions, a schedule with one queued Affiliate Debate slot, one affiliate episode
  await sql`DELETE FROM content_projects WHERE title IN ('Es batu bau bawang', 'Affiliate e2e episode')`;
  await sql`DELETE FROM affiliate_conversions`;
  await sql`DELETE FROM affiliate_products`;
  await sql`DELETE FROM content_schedules`;
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const [sc] = await sql`INSERT INTO content_schedules (user_id, format_mix) VALUES (${u.id}, '{comedy_debate,koran_kinetik}') RETURNING id`;
  const [slot] = await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, slot_index, format, status) VALUES (${sc.id}, ${u.id}, now() + interval '3 hours', 0, 'affiliate', 'queued') RETURNING id`;

  const b = await chromium.launch();
  const login = async (page) => {
    await page.goto(`${base}/login`);
    await page.fill('#password', process.env.APP_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/`);
  };
  let episodeId = null;

  for (const vp of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone 390', width: 390, height: 844 },
  ]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await login(page);
    const first = vp.width > 500;
    const pname = first ? 'Ice Tray Silikon FreshBox' : 'Blender Mini Portabel';

    // ------------------------------------------------------------ Schedule: the Product Bank
    await page.goto(`${base}/schedule`);
    const bank = page.locator('[data-product-bank]');
    await bank.waitFor();
    check(`${vp.name}: the section heading`, (await page.getByRole('heading', { name: 'Affiliate Product Bank', level: 2 }).count()) === 1);
    if (first) check(`${vp.name}: Empty state`, (await bank.locator('[data-empty]').innerText()) === 'No affiliate products yet. Add a product to unlock Affiliate Debate slots.');
    check(`${vp.name}: one amber primary on Schedule (Save schedule)`, (await page.locator('main .btn-primary').count()) === 1 && (await bank.locator('.btn-primary').count()) === 0);

    // Add product: opens, Escape cancels (focus back on the toggle), reopens
    const add = page.locator('[data-add-product]');
    await add.click();
    check(`${vp.name}: Add product opens (aria-expanded)`, (await add.getAttribute('aria-expanded')) === 'true' && (await page.getByLabel('Product name').evaluate((el) => el === document.activeElement)));
    await page.keyboard.press('Escape');
    check(`${vp.name}: Escape cancels the form, focus returns to Add product`, (await page.locator('[data-product-form="new"]').count()) === 0 && (await add.evaluate((el) => el === document.activeElement)));
    await add.click();
    // every field has a visible label
    for (const l of ['Product name', 'Category', 'Problem angle', 'Price (IDR)', 'Commission (%)', 'TikTok Shop URL', 'Shopee URL']) check(`${vp.name}: labelled "${l}"`, (await page.getByLabel(l, { exact: true }).count()) === 1);
    // Tab order: name → category → price → problem angle
    await page.getByLabel('Product name').focus();
    const order = [];
    for (let i = 0; i < 4; i++) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute('name')));
      await page.keyboard.press('Tab');
    }
    check(`${vp.name}: Tab order`, order.join(',') === 'name,category,price_idr,problem_angle', order.join(','));
    // Error state: validation announced
    await page.getByRole('button', { name: 'Save product' }).click();
    await page.locator('[data-product-error]').waitFor();
    check(`${vp.name}: validation error announced (role=alert)`, (await page.locator('[data-product-error]').getAttribute('role')) === 'alert' && /Product name is required/.test(await page.locator('[data-product-error]').innerText()));
    await page.getByLabel('Product name').fill(pname);
    await page.getByLabel('Category').selectOption(first ? 'Rumah Tangga' : 'Gadget');
    await page.getByLabel('Problem angle').fill(first ? 'es batu di freezer selalu bau bawang' : 'jus buah selalu berampas dan bikin seret');
    await page.getByLabel('Price (IDR)').fill(first ? '89000' : '249000');
    await page.getByLabel('Commission (%)').fill('7.5');
    await page.getByLabel('Shopee URL').fill('shopee.co.id/x');
    await page.getByRole('button', { name: 'Save product' }).click();
    await page.locator('[data-product-error]:has-text("Shopee URL")').waitFor();
    check(`${vp.name}: a bad link is refused`, /Shopee URL must be a full https:\/\/ link/.test(await page.locator('[data-product-error]').innerText()));
    check(`${vp.name}: an error keeps what was typed`, (await page.getByLabel('Product name').inputValue()) === pname && (await page.getByLabel('Price (IDR)').inputValue()) !== '');
    await page.getByLabel('Shopee URL').fill('https://s.shopee.co.id/e2e123');
    if (first) await page.getByLabel('TikTok Shop URL').fill('https://vt.tokopedia.com/t/e2e456');
    const save = page.getByRole('button', { name: 'Save product' });
    await save.click();
    await page.locator(`[data-product]:has-text("${pname}")`).waitFor({ timeout: 15000 });
    const row = page.locator(`[data-product]:has-text("${pname}")`);
    const rowText = await row.innerText();
    check(`${vp.name}: saved product listed with Rp price, commission, uses and an Active badge`, rowText.includes(first ? 'Rp 89.000' : 'Rp 249.000') && rowText.includes('7.5% commission') && rowText.includes('used 0 times') && (await row.locator('[data-status-badge="active"]').innerText()) === 'Active', rowText.replace(/\n/g, ' | '));
    check(`${vp.name}: price is tabular-nums`, (await row.locator('.tabular-nums').count()) >= 1);
    const badgeBorder = await row.locator('[data-status-badge]').evaluate((el) => getComputedStyle(el).borderTopWidth);
    check(`${vp.name}: status badge has text and a border`, badgeBorder === '1px', badgeBorder);

    // Pause / Activate
    await row.locator('[data-product-toggle]').click();
    await row.locator('[data-status-badge="paused"]').waitFor();
    check(`${vp.name}: Pause`, (await row.locator('[data-product-toggle]').innerText()) === 'Activate');
    const cursor = await row.locator('[data-product-toggle]').evaluate((el) => getComputedStyle(el).cursor);
    check(`${vp.name}: buttons use cursor: pointer`, cursor === 'pointer', cursor);
    await row.locator('[data-product-toggle]').click();
    await row.locator('[data-status-badge="active"]').waitFor();
    check(`${vp.name}: Activate`, true);

    // Edit: Escape cancels (focus back on Edit), then a real edit
    await row.locator('[data-product-edit]').click();
    await page.keyboard.press('Escape');
    check(`${vp.name}: Escape cancels Edit, focus returns to Edit`, (await row.locator('[data-product-edit]').evaluate((el) => el === document.activeElement)));
    await row.locator('[data-product-edit]').click();
    await row.getByLabel('Price (IDR)').fill(first ? '79000' : '239000');
    await row.getByRole('button', { name: 'Save product' }).click();
    await page.locator(`[data-product]:has-text("${first ? 'Rp 79.000' : 'Rp 239.000'}")`).waitFor({ timeout: 15000 });
    check(`${vp.name}: Edit saves`, true);

    // a queued Affiliate Debate slot: pick the product
    const picker = page.locator('[data-slot-product] select');
    await picker.selectOption({ label: pname });
    await page.locator('[data-slot-product]:has-text("This slot sells the chosen product.")').waitFor();
    const pinned = await sql`SELECT a.name FROM episode_queue q JOIN affiliate_products a ON a.id = q.affiliate_product_id WHERE q.id = ${slot.id}`;
    check(`${vp.name}: the slot is pinned to the product`, pinned[0]?.name === pname, pinned[0]?.name);
    // the schedule's slot format selector offers Affiliate Debate
    const fmt = page.getByLabel('Slot 1 format');
    await fmt.selectOption('affiliate');
    check(`${vp.name}: Affiliate Debate in the slot format selector`, (await fmt.inputValue()) === 'affiliate' && (await fmt.locator('option[value="affiliate"]').innerText()) === 'Affiliate Debate');
    await audit(page, `${vp.name} Schedule (Product Bank, slot)`, '[data-product-bank], [data-slot-product]');
    await bank.screenshot({ path: path.join(OUT, `affiliate-bank-${vp.width}.png`) });

    // Delete: inline confirm, Escape backs out, then delete a throwaway product
    await add.click();
    await page.getByLabel('Product name').fill('Produk sementara');
    await page.getByLabel('Problem angle').fill('masalah sementara');
    await page.getByLabel('Price (IDR)').fill('1000');
    await page.getByRole('button', { name: 'Save product' }).click();
    const tmp = page.locator('[data-product]:has-text("Produk sementara")');
    await tmp.waitFor({ timeout: 15000 });
    await tmp.locator('[data-product-delete]').click();
    check(`${vp.name}: Delete asks first`, (await tmp.locator('[data-product-confirm-delete]').isVisible()));
    await page.keyboard.press('Escape');
    check(`${vp.name}: Escape keeps the product`, (await tmp.locator('[data-product-delete]').evaluate((el) => el === document.activeElement)));
    await tmp.locator('[data-product-delete]').click();
    await tmp.locator('[data-product-confirm-delete]').click();
    await tmp.waitFor({ state: 'detached', timeout: 15000 });
    check(`${vp.name}: Delete`, (await sql`SELECT count(*)::int AS n FROM affiliate_products WHERE name = 'Produk sementara'`)[0].n === 0);

    // ------------------------------------------------------------ Episode: Affiliate Hand-Off
    if (first) {
      const [prod] = await sql`SELECT * FROM affiliate_products WHERE name = ${pname}`;
      const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status, affiliate_product_id, pinned_comment, affiliate_handoff_note)
        VALUES (${u.id}, 'Es batu bau bawang', 'short_video', '{tiktok}', 'recorded', ${prod.id},
          ${'Yang nanya Ice Tray Silikon FreshBox di video tadi: ini link-nya ya\nhttps://s.shopee.co.id/e2e123\n#affiliate #ucoocu'},
          ${'Produk: Ice Tray Silikon FreshBox (Rp 79.000)\nTikTok Shop: https://vt.tokopedia.com/t/e2e456\nShopee: https://s.shopee.co.id/e2e123\n1. TikTok: turn ON the AI-generated content disclosure before posting.\n2. TikTok: attach the product to the Yellow Basket (Keranjang Kuning).\n3. Shopee Video: attach the product to the Orange Basket (Keranjang Oranye).\n4. Instagram / YouTube: paste the pinned comment and pin it.'})
        RETURNING id`;
      const [s] = await sql`INSERT INTO scripts (project_id, version, title, lines, sources, custom, approved_at) VALUES (${p.id}, 1, 'Es batu bau bawang', ${sql.json([{ beat: 'hook', speaker: 'uco', text: 'Kenapa es batu gue bau bawang?!', subtitle: 'Why does my ice smell like onions?!', expression: 'angry', emotion: 'angry', thought_bubble: false, visual: '', sfx: [] }])}, '[]', true, now()) RETURNING id`;
      await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms) VALUES (${p.id}, ${s.id}, ${`${p.id}/video/test.mp4`}, 10, 60000)`;
      episodeId = p.id;
      // a plain episode (no product) shows no hand-off card
      const [plain] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status) VALUES (${u.id}, 'Affiliate e2e episode', 'short_video', '{tiktok}', 'recorded') RETURNING id`;
      await page.goto(`${base}/create/${plain.id}`);
      await page.locator('main h1').first().waitFor();
      check(`${vp.name}: no Affiliate Hand-Off on a non-affiliate episode`, (await page.locator('[data-affiliate-handoff]').count()) === 0);
    }
    await page.goto(`${base}/create/${episodeId}`);
    const card = page.locator('[data-affiliate-handoff]');
    await card.waitFor();
    const cardText = await card.innerText();
    check(`${vp.name}: hand-off shows the product and Rp price`, cardText.includes('Ice Tray Silikon FreshBox') && cardText.includes('Rp 79.000'));
    const links = await card.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]));
    check(`${vp.name}: shop links open safely in a new tab`, links.length === 2 && links.every(([, , t, r]) => t === '_blank' && r === 'noopener noreferrer') && links[0][1] === 'https://vt.tokopedia.com/t/e2e456', JSON.stringify(links));
    check(`${vp.name}: the checklist highlights the AI disclosure and the baskets`, (await card.locator('li.font-semibold').count()) === 3 && cardText.includes('AI-generated content'));
    await card.locator('[data-copy-pinned]').click();
    await card.locator('[data-copy-pinned]:has-text("Copied")').waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(`${vp.name}: Copy pinned comment copies it, with live "Copied" feedback`, clip.includes('https://s.shopee.co.id/e2e123') && (await card.locator('[data-copy-status]').innerText()) === 'Pinned comment copied.');
    await audit(page, `${vp.name} Affiliate Hand-Off`, '[data-affiliate-handoff]');
    await card.screenshot({ path: path.join(OUT, `affiliate-handoff-${vp.width}.png`) });

    // ------------------------------------------------------------ /insights: Affiliate Conversions
    await page.goto(`${base}/insights`);
    const sec = page.locator('[data-section="affiliate"]');
    await sec.locator('[data-log-orders]').waitFor();
    if (first) check(`${vp.name}: conversions Empty state`, (await sec.locator('[data-empty]').innerText()) === 'No affiliate orders logged yet.');
    await sec.locator('[data-log-orders] summary').click();
    for (const l of ['Episode', 'Platform', 'Clicks', 'Orders', 'Commission (IDR)']) check(`${vp.name}: log form labelled "${l}"`, (await sec.getByLabel(l, { exact: true }).count()) === 1);
    await sec.getByLabel('Episode', { exact: true }).selectOption(episodeId);
    await sec.getByLabel('Platform', { exact: true }).selectOption(first ? 'tiktok_shop' : 'shopee_video');
    // Error state: orders above clicks
    await sec.getByLabel('Clicks', { exact: true }).fill('3');
    await sec.getByLabel('Orders', { exact: true }).fill('9');
    await sec.locator('[data-log-orders-submit]').click();
    await sec.locator('[data-log-error]').waitFor();
    check(`${vp.name}: log Error state (validation, role=alert)`, /Orders can't be more than clicks/.test(await sec.locator('[data-log-error]').innerText()));
    // Loading then Saved
    await page.route('**/api/insights/affiliate-conversions', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    await sec.getByLabel('Clicks', { exact: true }).fill(first ? '1.250' : '300');
    await sec.getByLabel('Orders', { exact: true }).fill(first ? '31' : '6');
    await sec.getByLabel('Commission (IDR)', { exact: true }).fill(first ? '245000' : '45000');
    await sec.locator('[data-log-orders-submit]').click();
    check(`${vp.name}: log Loading state`, (await sec.locator('[data-log-orders-submit]').innerText()) === 'Saving...');
    await sec.locator('[data-log-saved]').waitFor({ timeout: 15000 });
    await page.unroute('**/api/insights/affiliate-conversions');
    await page.locator('[data-affiliate-totals]').waitFor({ timeout: 15000 });
    const totals = await page.locator('[data-affiliate-totals]').innerText();
    const want = first ? ['31', '1.250', 'Rp 245.000'] : ['37', '1.550', 'Rp 290.000'];
    check(`${vp.name}: real totals (Orders, Clicks, Commission)`, want.every((w) => totals.includes(w)), totals.replace(/\n/g, ' | '));
    check(`${vp.name}: totals are tabular-nums`, (await page.locator('[data-affiliate-totals] dd.tabular-nums').count()) === 3);
    check(`${vp.name}: per-episode breakdown`, (await page.locator('[data-affiliate-episodes] li').count()) === 1 && (await page.locator('[data-affiliate-episodes]').innerText()).includes('Es batu bau bawang'));
    // a server error is shown, not swallowed
    await sec.locator('[data-log-orders] summary').evaluate((el) => (el.parentElement.open = true));
    await page.route('**/api/insights/affiliate-conversions', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The database is busy: pool timeout. Try again.' }) }));
    await sec.getByLabel('Episode', { exact: true }).selectOption(episodeId);
    await sec.getByLabel('Orders', { exact: true }).fill('1');
    await sec.getByLabel('Clicks', { exact: true }).fill('1');
    await sec.locator('[data-log-orders-submit]').click();
    await sec.locator('[data-log-error]').waitFor();
    check(`${vp.name}: log Error state (server)`, /database is busy/.test(await sec.locator('[data-log-error]').innerText()));
    await page.unroute('**/api/insights/affiliate-conversions');
    // the route refuses an anonymous request
    const anon = await (await b.newContext()).request.post(`${base}/api/insights/affiliate-conversions`, { data: { episodeId, platform: 'tiktok_shop', orders: 1 }, maxRedirects: 0 });
    check(`${vp.name}: the route needs the session`, anon.status() === 401 || anon.status() === 307, String(anon.status()));
    await audit(page, `${vp.name} Affiliate Conversions`, '[data-section="affiliate"]');
    await sec.screenshot({ path: path.join(OUT, `affiliate-insights-${vp.width}.png`) });

    check(`${vp.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await b.close();
  await sql`DELETE FROM content_projects WHERE title IN ('Es batu bau bawang', 'Affiliate e2e episode')`;
  await sql`DELETE FROM affiliate_conversions`;
  await sql`DELETE FROM affiliate_products`;
  await sql`DELETE FROM content_schedules`;
  await sql.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
