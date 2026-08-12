import { expect, test } from "@playwright/test";

test("public vault data renders while the balance stays sealed", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Current prize")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal your balance" })).toBeVisible();
  await expect(page.getByText("12,480.00 cUSDC")).toHaveCount(0);
});

test("deposit privacy paths disclose the public shield boundary", async ({ page }) => {
  await page.goto("/deposit");

  await expect(page.getByRole("radio", { name: /Private cUSDC/ })).toBeChecked();
  await page.getByRole("radio", { name: /Public USDC/ }).click();
  await expect(page.getByText(/Shielding publishes this amount on-chain/)).toBeVisible();
  await page.getByRole("spinbutton", { name: "Amount" }).fill("100");
  await expect(page.getByRole("button", { name: "Shield and continue" })).toBeEnabled();
});

test("risk defaults to 100 percent without an odds estimate", async ({ page }) => {
  await page.goto("/risk");

  await expect(page.getByRole("radio", { name: "100%" })).toBeChecked();
  await expect(page.getByText(/Estimated odds/i)).toHaveCount(0);
});

test("draw demo exposes every modeled state", async ({ page }) => {
  await page.goto("/draw");
  const states = ["IDLE", "OPEN", "SWEEP_A", "AWAIT_TOTAL", "REVEAL", "RANDOM_SET", "SWEEP_B", "SETTLED"];

  for (const state of states) {
    await page.getByRole("combobox", { name: "Draw state" }).selectOption(state);
    await expect(page.getByRole("heading", { name: state })).toBeVisible();
  }
});

test("result check stays neutral until local decryption", async ({ page }) => {
  await page.goto("/proof");

  await expect(page.getByRole("button", { name: "Check my result" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Publish proof/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Check my result" }).click();
  await expect(page.getByRole("button", { name: "Publish proof" })).toBeVisible();
  await expect(page.getByText(/Publishing is your choice, and it cannot be undone/)).toBeVisible();
});

test("every route fits the target viewport", async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  const routes = ["/", "/deposit", "/risk", "/draw", "/proof", "/why-encrypted"];
  for (const route of routes) {
    await page.goto(route);
    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -0.5 || bounds.right > window.innerWidth + 0.5;
        })
        .slice(0, 8)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    }));
    expect(layout.documentWidth, `${route}: ${layout.overflowing.join(", ")}`).toBeLessThanOrEqual(
      layout.viewportWidth,
    );
    const name = route === "/" ? "vault" : route.slice(1);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
  expect(runtimeErrors).toEqual([]);
});
