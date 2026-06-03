const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", err => errors.push(err.message));

  const baseUrl = process.env.APP_URL || "http://localhost:8788/";
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: "output/playwright/mental-lab-intro.png", fullPage: true });
  const tabLabels = await page.locator("#viewTabs button").evaluateAll(buttons => buttons.map(button => button.textContent.trim()));
  await page.click('[data-intro-dataset="pedestrian"]');

  await page.waitForSelector("#graphSvg circle", { timeout: 15000 });
  const networkNodes = await page.locator("#graphSvg circle").count();
  await page.screenshot({ path: "output/playwright/mental-lab-network.png", fullPage: true });

  await page.click('[data-tab="mental"]');
  await page.waitForSelector("#mentalList .record-card", { timeout: 30000 });
  const mentalCards = await page.locator("#mentalList .record-card").count();
  await page.locator("#mentalList .record-card").first().click();
  await page.waitForSelector(".actor-card", { timeout: 30000 });
  const actorCards = await page.locator(".actor-card").count();

  await page.click('[data-tab="stories"]');
  await page.waitForSelector(".story-card", { timeout: 10000 });
  const storyCards = await page.locator(".story-card").count();

  await page.click('[data-tab="validation"]');
  await page.waitForSelector("#validationDashboard .dashboard-card", { timeout: 10000 });
  const validationCards = await page.locator("#validationDashboard .dashboard-card").count();

  await page.click('[data-tab="review"]');
  await page.waitForSelector("#reviewList .record-card", { timeout: 30000 });
  const reviewCards = await page.locator("#reviewList .record-card").count();

  await page.click('[data-tab="crashes"]');
  await page.waitForSelector("#crashList .crash-card", { timeout: 30000 });
  await page.locator("#crashList .crash-card").first().click();
  await page.waitForSelector(".narr-text", { timeout: 30000 });
  const narrativeText = await page.locator(".narr-text").first().innerText();
  await page.screenshot({ path: "output/playwright/mental-lab-crash.png", fullPage: true });

  await page.click('[data-tab="heatmap"]');
  await page.waitForSelector("#heatmapContainer svg rect, #coocTopPairs .cooc-pair", { timeout: 10000 });
  const coocPairs = await page.locator("#coocTopPairs .cooc-pair").count();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: "output/playwright/mental-lab-mobile-intro.png", fullPage: true });

  await browser.close();
  const result = { tabLabels, networkNodes, mentalCards, actorCards, storyCards, validationCards, reviewCards, coocPairs, narrativeLength: narrativeText.length, errors };
  console.log(JSON.stringify(result, null, 2));
  if (
    errors.length ||
    tabLabels.includes("Compare") ||
    tabLabels.includes("Methods") ||
    networkNodes < 5 ||
    mentalCards < 5 ||
    actorCards < 1 ||
    storyCards < 2 ||
    validationCards < 1 ||
    reviewCards < 1 ||
    coocPairs < 1 ||
    narrativeText.length < 80 ||
    !tabLabels.includes("Co-occurrence")
  ) {
    process.exit(1);
  }
})();
