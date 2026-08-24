import { expect, test } from "@playwright/test";

const primaryLabels = ["Vault", "Deposit", "Risk", "Draw", "Proof"];

test("skip link moves keyboard focus to main content", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator("#main-content")).toBeFocused();
});

test("primary routes remain keyboard reachable in logical order", async ({ page }) => {
  await page.goto("/");
  const viewport = page.viewportSize();
  const navigation = page.getByRole("navigation", {
    name: (viewport?.width ?? 0) >= 1024 ? "Primary navigation" : "Mobile navigation",
  });

  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link").allTextContents()).resolves.toEqual(primaryLabels);
  for (const label of primaryLabels) {
    const link = navigation.getByRole("link", { name: label });
    await link.focus();
    await expect(link).toBeFocused();
  }
});

test("wallet and primary controls have a visible focus indicator", async ({ page }) => {
  await page.goto("/proof");

  for (const control of [
    page.getByRole("button", { name: "Connect wallet" }).first(),
    page.getByRole("button", { name: "Claim / check prize" }),
  ]) {
    await control.focus();
    const focusStyle = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  }
});

test("all routes fit with 200 percent text zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  const routes = ["/", "/deposit", "/risk", "/draw", "/proof", "/why-encrypted"];

  for (const route of routes) {
    await page.goto(route);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth, route).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("reduced motion disables the loading animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/proof");
  const duration = await page.evaluate(() => {
    const sample = document.createElement("span");
    sample.className = "spin";
    document.body.append(sample);
    return getComputedStyle(sample).animationDuration;
  });

  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);
});

test("mobile navigation does not obscure a focused primary action", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "Fixed mobile navigation is not rendered on desktop.");
  await page.goto("/proof");
  const action = page.getByRole("button", { name: "Claim / check prize" });
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });

  await action.focus();
  await action.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
  const actionBox = await action.boundingBox();
  const navigationBox = await navigation.boundingBox();

  expect(actionBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect((actionBox?.y ?? 0) + (actionBox?.height ?? 0)).toBeLessThanOrEqual((navigationBox?.y ?? 0) - 4);
});
