---
name: playwright-testing
description: >-
  End-to-end (E2E) testing, visual regression testing, accessibility audits, and headless browser
  automation with Playwright. Use when testing user journeys, forms, authentication flows, and UI integrity.
---

# Playwright Testing & Automation Skill

This skill provides guidelines and patterns for automated testing with Playwright.

## 1. Test Structure & Page Object Model (POM)
- Organize tests by user flow rather than internal technical units.
- Standard POM pattern:
  ```javascript
  class LoginPage {
    constructor(page) {
      this.page = page;
      this.emailInput = page.getByPlaceholder(/correo|email/i);
      this.passwordInput = page.getByPlaceholder(/contrase|password/i);
      this.submitBtn = page.getByRole('button', { name: /iniciar|login|entrar/i });
    }

    async login(email, password) {
      await this.emailInput.fill(email);
      await this.passwordInput.fill(password);
      await this.submitBtn.click();
    }
  }
  ```

## 2. Resilient Locators
- Prefer user-visible locators in this order:
  1. `page.getByRole(...)`
  2. `page.getByLabel(...)`
  3. `page.getByPlaceholder(...)`
  4. `page.getByText(...)`
  5. `page.getByTestId(...)`
- Avoid brittle CSS selectors like `div > div:nth-child(3) > button`.

## 3. Visual Regression & Screenshots
- Capture screenshots at critical checkpoints:
  ```javascript
  await expect(page).toHaveScreenshot('dashboard-home.png', {
    maxDiffPixelRatio: 0.05,
  });
  ```

## 4. Network Mocking & Authentication State
- Save and reuse storage states (cookies, localStorage) to speed up test suites:
  ```javascript
  await page.context().storageState({ path: 'auth-state.json' });
  ```
