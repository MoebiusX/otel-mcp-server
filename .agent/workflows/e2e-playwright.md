---
description: Running Playwright E2E tests for browser-based testing
---

# E2E Testing with Playwright

Run browser-based E2E tests for trading flows, authentication, and transparency dashboard.

## Prerequisites

// turbo
1. Ensure the dev server is running (Playwright can start it automatically):
```bash
npm run dev
```

## Running Tests

// turbo
2. Run all E2E tests (headless):
```bash
npm run test:e2e:playwright
```

// turbo
3. Run tests with interactive UI (for debugging):
```bash
npm run test:e2e:ui
```

// turbo  
4. Run tests with visible browser:
```bash
npm run test:e2e:headed
```

## Running Specific Tests

// turbo
5. Run only authentication tests:
```bash
npx playwright test e2e/auth.spec.ts
```

// turbo
6. Run only trading tests:
```bash
npx playwright test e2e/trading.spec.ts
```

// turbo
7. Run only transparency tests:
```bash
npx playwright test e2e/transparency.spec.ts
```

## Viewing Test Reports

// turbo
8. View HTML test report:
```bash
npx playwright show-report
```

## Test Coverage

- **auth.spec.ts** - Registration, login, logout, protected routes
- **trading.spec.ts** - Buy/sell orders, balance validation, trace links
- **transparency.spec.ts** - Landing page metrics, system status

## Troubleshooting

If tests fail due to timeout, ensure:
1. Docker services are running (`docker-compose up -d`)
2. Dev server started successfully
3. Database has been initialized
