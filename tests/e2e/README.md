# End-to-end tests

Playwright specs cover the workflows the specification calls out in §26:

- Public ticket submission
- Public equipment request
- Agent ticket management
- Asset creation
- Employee creation
- Equipment approval end to end
- Sign in and sign out
- Password reset

The specs and the `playwright.config.ts` will land in this directory in the next
increment. Run them against a running instance with:

```bash
npm run build && npm run start &
npx playwright test
```

In CI, the `verify` job builds and runs unit + integration tests; end-to-end runs
against the deployed staging slot after the smoke-test step in
`.github/workflows/azure-deploy.yml`.
