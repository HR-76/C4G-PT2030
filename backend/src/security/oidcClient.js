class OidcClient {
  constructor(config, overrides = {}) {
    this.settings = config;
    this.configurationPromise = overrides.configuration ? Promise.resolve(overrides.configuration) : null;
    this.libraryPromise = overrides.library ? Promise.resolve(overrides.library) : null;
    this.nonRepudiationEnabled = false;
    this.now = overrides.now || Date.now;
    this.discoveryFailures = 0;
    this.discoveryRetryAt = 0;
    this.discoveryError = null;
  }

  async library() {
    if (!this.libraryPromise) this.libraryPromise = import("openid-client");
    return this.libraryPromise;
  }

  async configuration() {
    if (!this.configurationPromise) {
      if (this.now() < this.discoveryRetryAt) throw this.discoveryError;
      const pending = this.library().then(client => client.discovery(
        this.settings.issuer,
        this.settings.clientId,
        this.settings.clientSecret
      )).then(configuration => {
        this.discoveryFailures = 0;
        this.discoveryRetryAt = 0;
        this.discoveryError = null;
        return configuration;
      }).catch(error => {
        if (this.configurationPromise === pending) this.configurationPromise = null;
        this.discoveryFailures = Math.min(this.discoveryFailures + 1, 6);
        this.discoveryRetryAt = this.now() + Math.min(30000, 1000 * 2 ** (this.discoveryFailures - 1));
        this.discoveryError = error;
        throw error;
      });
      this.configurationPromise = pending;
    }
    const [client, configuration] = await Promise.all([this.library(), this.configurationPromise]);
    if (!this.nonRepudiationEnabled && typeof client.enableNonRepudiationChecks === "function") {
      client.enableNonRepudiationChecks(configuration);
      this.nonRepudiationEnabled = true;
    }
    return configuration;
  }

  async begin({ stepUp = false, maxAge, acrValues = [], returnPath, accountAction = null }) {
    if (accountAction && (!this.settings.emailVerification || !['enable', 'disable'].includes(accountAction))) {
      throw new Error('Invalid account action.');
    }
    const client = await this.library();
    const configuration = await this.configuration();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const parameters = {
      redirect_uri: this.settings.redirectUri.href,
      scope: "openid profile email",
      ui_locales: "pt-PT pt",
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce
    };
    if (stepUp) {
      parameters.prompt = "login";
      parameters.max_age = String(maxAge);
      if (acrValues.length > 0) parameters.acr_values = acrValues.join(" ");
    }
    if (accountAction) parameters.kc_action = `c4g-email-${accountAction}`;
    return {
      redirectUrl: client.buildAuthorizationUrl(configuration, parameters).href,
      transaction: { codeVerifier, state, nonce, stepUp, maxAge, returnPath, createdAt: Date.now() }
    };
  }

  async callback(currentUrl, transaction) {
    const client = await this.library();
    const configuration = await this.configuration();
    const tokens = await client.authorizationCodeGrant(configuration, new URL(currentUrl), {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
      ...(transaction.stepUp ? { maxAge: transaction.maxAge } : {})
    });
    const claims = tokens.claims();
    if (!claims || !claims.sub) throw new Error("OIDC response did not include valid identity claims.");
    return { claims, ...(this.settings.emailVerification ? {
      accountAccessToken: tokens.access_token,
      accountTokenExpiresAt: Date.now() + Math.max(0, Math.min(Number(tokens.expires_in) || 0, 1800)) * 1000
    } : {}) };
  }

  async endSessionUrl() {
    const client = await this.library();
    const configuration = await this.configuration();
    return client.buildEndSessionUrl(configuration, {
      post_logout_redirect_uri: this.settings.postLogoutRedirectUri.href,
      ui_locales: "pt-PT pt",
      client_id: this.settings.clientId
    }).href;
  }
}

module.exports = { OidcClient };
