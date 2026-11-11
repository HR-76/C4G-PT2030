'use strict';
// Keep the local app independent of the integration suite's two-second MFA flow.
// Only an installation-owned flow and its client binding are modified.
async function configureLocalFlow(kc, state, clientId, optional = false) {
  const alias = clientId + (optional ? '-optional-browser' : '-browser'), description = 'C4G local installation ' + state.installationId;
  let flow = (await kc('authentication/flows')).find(item => item.alias === alias);
  if (flow && flow.description !== description) throw Error('LOCAL_IDENTITY_FLOW_ALREADY_OWNED');
  if (!flow) {
    await kc('authentication/flows', 'POST', { alias, description, providerId: 'basic-flow', topLevel: true, builtIn: false });
    flow = (await kc('authentication/flows')).find(item => item.alias === alias);
  }
  async function execution(parent, provider, requirement, config) {
    const route = 'authentication/flows/' + parent + '/executions';
    let entry = (await kc(route)).find(item => item.providerId === provider && item.level === 0);
    if (!entry) {
      await kc(route + '/execution', 'POST', { provider });
      entry = (await kc(route)).find(item => item.providerId === provider && item.level === 0);
    }
    if (!entry) throw Error('LOCAL_IDENTITY_FLOW_EXECUTION_MISSING');
    if (entry.requirement !== requirement) await kc(route, 'PUT', { ...entry, requirement });
    if (config) {
      const expected = { alias: parent + '-' + provider, config };
      if (!entry.authenticationConfig) await kc('authentication/executions/' + entry.id + '/config', 'POST', expected);
      else {
        const current = await kc('authentication/config/' + entry.authenticationConfig);
        const isReference = Object.hasOwn(config, 'default.reference.value');
        const maskedReference = isReference && current.config?.['default.reference.value'] === '**********';
        const maskedLifetime = isReference && current.config?.['default.reference.maxAge'] === '**********';
        const needsReferenceLifetime = isReference && current.config?.['default.reference.maxAge'] === undefined;
        const differs = Object.entries(config).some(([key, value]) => current.config?.[key] !== value
          && !(key === 'default.reference.value' && maskedReference)
          && !(key === 'default.reference.maxAge' && (needsReferenceLifetime || maskedLifetime)));
        if (current.alias !== expected.alias || differs) {
          throw Error('LOCAL_IDENTITY_FLOW_CONFIGURATION_DRIFT');
        }
        // Keycloak masks this authenticator setting on GET. Reconcile the owned
        // config to the required reference; never interpret the mask as evidence.
        if (maskedReference || maskedLifetime || needsReferenceLifetime) await kc('authentication/config/' + entry.authenticationConfig, 'PUT', { ...current, config });
      }
    }
  }
  async function child(parent, suffix, requirement) {
    const name = alias + '-' + suffix, route = 'authentication/flows/' + parent + '/executions';
    let entry = (await kc(route)).find(item => item.displayName === name);
    if (!entry) {
      await kc(route + '/flow', 'POST', { alias: name, description, provider: 'basic-flow', type: 'basic-flow' });
      entry = (await kc(route)).find(item => item.displayName === name);
    }
    if (!entry) throw Error('LOCAL_IDENTITY_SUBFLOW_MISSING');
    if (entry.requirement !== requirement) await kc(route, 'PUT', { ...entry, requirement });
    return name;
  }
  await execution(alias, 'auth-cookie', 'ALTERNATIVE');
  const forms = await child(alias, 'forms', 'ALTERNATIVE');
  if (optional) {
    await execution(forms, 'auth-username-password-form', 'REQUIRED', { 'default.reference.value': 'pwd', 'default.reference.maxAge': '300' });
    const otp = await child(forms, 'otp', 'CONDITIONAL');
    await execution(otp, 'conditional-user-configured', 'REQUIRED');
    await execution(otp, 'auth-otp-form', 'REQUIRED', { 'default.reference.value': 'otp', 'default.reference.maxAge': '300' });
    return flow.id;
  }
  for (const [level, provider, reference] of [[1, 'auth-username-password-form', 'pwd'], [2, 'auth-otp-form', 'otp']]) {
    const loa = await child(forms, 'loa' + level, 'CONDITIONAL');
    await execution(loa, 'conditional-level-of-authentication', 'REQUIRED', { 'loa-condition-level': String(level), 'loa-max-age': '300' });
    await execution(loa, provider, 'REQUIRED', { 'default.reference.value': reference, 'default.reference.maxAge': '300' });
  }
  return flow.id;
}
module.exports = { configureLocalFlow, configureOptionalFlow: (kc, state, clientId) => configureLocalFlow(kc, state, clientId, true) };
