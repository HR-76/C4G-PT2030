// Run with playwright-cli run-code --filename after opening the existing local IdP.
// No setup, SQL, account changes or real account login; one fictitious rejected login.
async (page) => {
  const base = 'https://localhost:8443/realms/c4g-native-local/protocol/openid-connect/auth?client_id=c4g-native-local&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Foidc%2Fcallback&response_type=code&scope=openid&code_challenge=c4g-localization-browser-check-01234567890123456789&code_challenge_method=S256';
  const results = [];
  for (const locale of ['en-US', 'pt-BR']) {
    const context = await page.context().browser().newContext({ locale, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    const probe = await context.newPage();
    try {
      await probe.goto(base);
      await probe.getByRole('heading', { name: 'Entre na sua conta', exact: true }).waitFor();
      if (await probe.locator('html').getAttribute('lang') !== 'pt') throw Error('HTML_LANGUAGE');
      await probe.getByRole('textbox', { name: 'Nome de utilizador', exact: true }).waitFor();
      await probe.getByRole('button', { name: 'Mostrar palavra-passe', exact: true }).click();
      if (await probe.locator('#password').getAttribute('type') !== 'text') throw Error('SHOW_PASSWORD');
      await probe.getByRole('button', { name: 'Ocultar palavra-passe', exact: true }).click();
      if (await probe.locator('#password').getAttribute('type') !== 'password') throw Error('HIDE_PASSWORD');
      for (const width of [1440, 390]) {
        await probe.setViewportSize({ width, height: 1000 });
        if (await probe.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('OVERFLOW');
        await probe.screenshot({ path: 'output/playwright/login-portuguese-portugal/login-' + locale + '-' + width + '.png', fullPage: true, animations: 'disabled' });
      }
      await probe.getByText('Esqueci-me da palavra-passe', { exact: true }).click();
      await probe.getByText(/Não partilhe a sua palavra-passe/).waitFor();
      await probe.goto(base + '&ui_locales=pt-PT%20pt');
      await probe.getByRole('heading', { name: 'Entre na sua conta', exact: true }).waitFor();
      if (locale === 'en-US') {
        await probe.getByRole('textbox', { name: 'Nome de utilizador', exact: true }).fill('c4g.locale.probe.20261029.invalid');
        await probe.locator('#password').fill('synthetic-invalid-password');
        await probe.getByRole('button', { name: 'Entrar', exact: true }).click();
        await probe.getByText('Nome de utilizador ou palavra-passe inválidos.', { exact: true }).waitFor();
        await probe.screenshot({ path: 'output/playwright/login-portuguese-portugal/invalid-credentials-390.png', fullPage: true, animations: 'disabled' });
      }
      results.push({ browserLocale: locale, defaultLocale: 'pt', oidcPreference: 'pt-PT pt', desktop: true, mobile: true, passwordToggle: true, recoveryHelp: true });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ result: 'PASS', invalidCredentialsInPortuguese: true, results }));
}
