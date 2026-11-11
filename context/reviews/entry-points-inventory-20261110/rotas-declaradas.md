# Declarações HTTP no código — 10/11/2026

Inventário estático por declaração literal em backend/src. O caminho é relativo ao router indicado; consultar a montagem e eventuais routers aninhados para obter a rota completa. Uma declaração não prova que esteja ativa ou acessível num ambiente. Expressões dinâmicas e funções de registo indiretas exigem conferência manual. Não inclui ficheiros de teste nem scripts locais.

| Ficheiro e linha | Router | Método | Caminho declarado |
|---|---|---|---|
| [backend/src/app.js:105](../../../backend/src/app.js#L105) | app | GET | `/` |
| [backend/src/app.js:120](../../../backend/src/app.js#L120) | app | GET | `/health/db` |
| [backend/src/app.js:136](../../../backend/src/app.js#L136) | app | GET | `/health/live` |
| [backend/src/app.js:137](../../../backend/src/app.js#L137) | app | GET | `/health/ready` |
| [backend/src/customerBilling/pdfHttp.js:17](../../../backend/src/customerBilling/pdfHttp.js#L17) | router | GET | `/documents/:id/pdf` |
| [backend/src/customerBilling/pdfHttp.js:18](../../../backend/src/customerBilling/pdfHttp.js#L18) | router | GET | `/documents/:id/pdf/:versionId` |
| [backend/src/customerBilling/pdfHttp.js:23](../../../backend/src/customerBilling/pdfHttp.js#L23) | router | PUT | `/documents/:id/pdf` |
| [backend/src/entityAdmission/http.js:36](../../../backend/src/entityAdmission/http.js#L36) | router | GET | `/admissions/mine` |
| [backend/src/entityAdmission/http.js:37](../../../backend/src/entityAdmission/http.js#L37) | router | GET | `/admin/directory/admissions` |
| [backend/src/entityAdmission/http.js:38](../../../backend/src/entityAdmission/http.js#L38) | router | POST | `/admissions/:id/submit` |
| [backend/src/entityAdmission/http.js:38](../../../backend/src/entityAdmission/http.js#L38) | router | GET | `/admissions/:id/status` |
| [backend/src/entityAdmission/http.js:39](../../../backend/src/entityAdmission/http.js#L39) | router | GET | `/admissions/:id/draft` |
| [backend/src/entityAdmission/http.js:40](../../../backend/src/entityAdmission/http.js#L40) | router | PUT | `/admissions/:id/draft` |
| [backend/src/entityAdmission/http.js:41](../../../backend/src/entityAdmission/http.js#L41) | router | POST | `/admissions/:id/validate` |
| [backend/src/entityAdmission/http.js:42](../../../backend/src/entityAdmission/http.js#L42) | router | POST | `/admin/directory/admissions` |
| [backend/src/entityAdmission/http.js:43](../../../backend/src/entityAdmission/http.js#L43) | router | GET | `/admin/directory/admissions/:id` |
| [backend/src/entityAdmission/http.js:45](../../../backend/src/entityAdmission/http.js#L45) | router | POST | `/admin/directory/admissions/:id/resume` |
| [backend/src/entityAdmission/http.js:46](../../../backend/src/entityAdmission/http.js#L46) | router | POST | `/admin/directory/admissions/:id/invitations` |
| [backend/src/entityAdmission/http.js:47](../../../backend/src/entityAdmission/http.js#L47) | router | POST | `/admin/directory/admissions/:id/cancel` |
| [backend/src/fundingTenders/http.js:24](../../../backend/src/fundingTenders/http.js#L24) | admin | GET | `/funding-tenders` |
| [backend/src/fundingTenders/http.js:32](../../../backend/src/fundingTenders/http.js#L32) | admin | POST | `/funding-tenders` |
| [backend/src/opportunities/v2/activationHttp.js:62](../../../backend/src/opportunities/v2/activationHttp.js#L62) | router | GET | `/plans` |
| [backend/src/opportunities/v2/activationHttp.js:63](../../../backend/src/opportunities/v2/activationHttp.js#L63) | router | POST | `/plans` |
| [backend/src/opportunities/v2/activationHttp.js:64](../../../backend/src/opportunities/v2/activationHttp.js#L64) | router | GET | `/plans/:planId` |
| [backend/src/opportunities/v2/activationHttp.js:65](../../../backend/src/opportunities/v2/activationHttp.js#L65) | router | POST | `/plans/:planId/` |
| [backend/src/opportunities/v2/activationHttp.js:66](../../../backend/src/opportunities/v2/activationHttp.js#L66) | router | GET | `/sources/eu` |
| [backend/src/opportunities/v2/activationHttp.js:67](../../../backend/src/opportunities/v2/activationHttp.js#L67) | router | POST | `/sources/eu/` |
| [backend/src/opportunities/v2/activationHttp.js:68](../../../backend/src/opportunities/v2/activationHttp.js#L68) | router | POST | `/sources/eu/writer` |
| [backend/src/opportunities/v2/activationHttp.js:69](../../../backend/src/opportunities/v2/activationHttp.js#L69) | router | GET | `/eu-writer/reviews` |
| [backend/src/opportunities/v2/activationHttp.js:70](../../../backend/src/opportunities/v2/activationHttp.js#L70) | router | GET | `/eu-writer/windows/:windowId` |
| [backend/src/opportunities/v2/activationHttp.js:71](../../../backend/src/opportunities/v2/activationHttp.js#L71) | router | POST | `/eu-writer/windows/:windowId/approve` |
| [backend/src/opportunities/v2/activationHttp.js:72](../../../backend/src/opportunities/v2/activationHttp.js#L72) | router | GET | `/eu-writer/reconciliations/:planId` |
| [backend/src/opportunities/v2/activationHttp.js:73](../../../backend/src/opportunities/v2/activationHttp.js#L73) | router | POST | `/eu-writer/reconciliations/:planId/` |
| [backend/src/opportunities/v2/activationHttp.js:78](../../../backend/src/opportunities/v2/activationHttp.js#L78) | router | GET | `/eu-legacy/preapprovals/:packageId` |
| [backend/src/opportunities/v2/activationHttp.js:83](../../../backend/src/opportunities/v2/activationHttp.js#L83) | router | GET | `/eu-legacy/preapprovals/:packageId/:itemDigest` |
| [backend/src/opportunities/v2/activationHttp.js:88](../../../backend/src/opportunities/v2/activationHttp.js#L88) | router | POST | `/eu-legacy/preapprovals/:packageId/:itemDigest/approve` |
| [backend/src/opportunities/v2/activationHttp.js:94](../../../backend/src/opportunities/v2/activationHttp.js#L94) | router | GET | `/eu-legacy/acceptance/:packageId` |
| [backend/src/opportunities/v2/activationHttp.js:99](../../../backend/src/opportunities/v2/activationHttp.js#L99) | router | GET | `/eu-legacy/acceptance/:packageId/:itemDigest` |
| [backend/src/opportunities/v2/activationHttp.js:104](../../../backend/src/opportunities/v2/activationHttp.js#L104) | router | POST | `/eu-legacy/acceptance/:packageId/:itemDigest/` |
| [backend/src/opportunities/v2/activationHttp.js:114](../../../backend/src/opportunities/v2/activationHttp.js#L114) | router | POST | `/calls/11145/collect` |
| [backend/src/opportunities/v2/activationHttp.js:115](../../../backend/src/opportunities/v2/activationHttp.js#L115) | router | POST | `/calls/11145/plans` |
| [backend/src/opportunities/v2/activationHttp.js:116](../../../backend/src/opportunities/v2/activationHttp.js#L116) | router | POST | `/calls/11145/plans/:planId/accept` |
| [backend/src/platformBilling/http.js:109](../../../backend/src/platformBilling/http.js#L109) | router | GET | `/summary` |
| [backend/src/platformBilling/http.js:110](../../../backend/src/platformBilling/http.js#L110) | router | GET | `/cycles` |
| [backend/src/platformBilling/http.js:111](../../../backend/src/platformBilling/http.js#L111) | router | GET | `/cycles/:cycleId` |
| [backend/src/platformBilling/http.js:114](../../../backend/src/platformBilling/http.js#L114) | router | GET | `/organizations/:organizationId/account` |
| [backend/src/platformBilling/http.js:117](../../../backend/src/platformBilling/http.js#L117) | router | PUT | `/organizations/:organizationId/account` |
| [backend/src/platformBilling/http.js:120](../../../backend/src/platformBilling/http.js#L120) | router | POST | `/cycles` |
| [backend/src/platformBilling/http.js:121](../../../backend/src/platformBilling/http.js#L121) | router | PUT | `/cycles/:cycleId` |
| [backend/src/platformBilling/http.js:124](../../../backend/src/platformBilling/http.js#L124) | router | POST | `/cycles/:cycleId/transitions` |
| [backend/src/platformBilling/http.js:127](../../../backend/src/platformBilling/http.js#L127) | router | POST | `/cycles/:cycleId/documents` |
| [backend/src/platformBilling/http.js:130](../../../backend/src/platformBilling/http.js#L130) | router | POST | `/documents/:documentId/transitions` |
| [backend/src/platformBilling/http.js:133](../../../backend/src/platformBilling/http.js#L133) | router | POST | `/documents/:documentId/payments` |
| [backend/src/platformBilling/http.js:136](../../../backend/src/platformBilling/http.js#L136) | router | POST | `/payments/:paymentId/reversals` |
| [backend/src/platformOnboarding/activationHttp.js:15](../../../backend/src/platformOnboarding/activationHttp.js#L15) | router | GET | `/` |
| [backend/src/platformOnboarding/activationHttp.js:16](../../../backend/src/platformOnboarding/activationHttp.js#L16) | router | POST | `/begin` |
| [backend/src/platformOnboarding/activationHttp.js:17](../../../backend/src/platformOnboarding/activationHttp.js#L17) | router | GET | `/callback` |
| [backend/src/platformOnboarding/activationHttp.js:18](../../../backend/src/platformOnboarding/activationHttp.js#L18) | router | GET | `/complete` |
| [backend/src/platformOnboarding/activationHttp.js:21](../../../backend/src/platformOnboarding/activationHttp.js#L21) | bridge | POST | `/check` |
| [backend/src/portugal2030/uploadHttp.js:15](../../../backend/src/portugal2030/uploadHttp.js#L15) | router | GET | `/` |
| [backend/src/portugal2030/uploadHttp.js:16](../../../backend/src/portugal2030/uploadHttp.js#L16) | router | POST | `/xlsx` |
| [backend/src/portugal2030/uploadHttp.js:28](../../../backend/src/portugal2030/uploadHttp.js#L28) | router | GET | `/:id` |
| [backend/src/portugal2030/uploadHttp.js:29](../../../backend/src/portugal2030/uploadHttp.js#L29) | router | POST | `/:id/preview` |
| [backend/src/routes/applicationSliceRoutes.js:31](../../../backend/src/routes/applicationSliceRoutes.js#L31) | router | GET | `/:id/documents/versions/:versionId/download` |
| [backend/src/routes/applicationSliceRoutes.js:61](../../../backend/src/routes/applicationSliceRoutes.js#L61) | router | POST | `/:id/documents/upload-intents` |
| [backend/src/routes/applicationSliceRoutes.js:62](../../../backend/src/routes/applicationSliceRoutes.js#L62) | router | PUT | `/:id/documents/uploads/:versionId` |
| [backend/src/routes/memberOnboardingRoutes.js:13](../../../backend/src/routes/memberOnboardingRoutes.js#L13) | router | GET | `/` |
| [backend/src/routes/memberOnboardingRoutes.js:14](../../../backend/src/routes/memberOnboardingRoutes.js#L14) | router | POST | `/` |
| [backend/src/routes/memberOnboardingRoutes.js:15](../../../backend/src/routes/memberOnboardingRoutes.js#L15) | router | GET | `/:operationId` |
| [backend/src/routes/memberOnboardingRoutes.js:16](../../../backend/src/routes/memberOnboardingRoutes.js#L16) | router | POST | `/:operationId/resume` |
| [backend/src/routes/memberOnboardingRoutes.js:17](../../../backend/src/routes/memberOnboardingRoutes.js#L17) | router | POST | `/:operationId/activation-email` |
| [backend/src/routes/memberOnboardingRoutes.js:18](../../../backend/src/routes/memberOnboardingRoutes.js#L18) | router | POST | `/:operationId/invitations` |
| [backend/src/routes/memberOnboardingRoutes.js:19](../../../backend/src/routes/memberOnboardingRoutes.js#L19) | router | POST | `/:operationId/invitations/:invitationId/revoke` |
| [backend/src/routes/oidcAuthRoutes.js:5](../../../backend/src/routes/oidcAuthRoutes.js#L5) | router | GET | `/oidc/login` |
| [backend/src/routes/oidcAuthRoutes.js:6](../../../backend/src/routes/oidcAuthRoutes.js#L6) | router | GET | `/oidc/callback` |
| [backend/src/routes/oidcAuthRoutes.js:7](../../../backend/src/routes/oidcAuthRoutes.js#L7) | router | GET | `/step-up` |
| [backend/src/routes/oidcAuthRoutes.js:8](../../../backend/src/routes/oidcAuthRoutes.js#L8) | router | GET | `/step-up-policy` |
| [backend/src/routes/oidcAuthRoutes.js:9](../../../backend/src/routes/oidcAuthRoutes.js#L9) | router | GET | `/account-security` |
| [backend/src/routes/oidcAuthRoutes.js:10](../../../backend/src/routes/oidcAuthRoutes.js#L10) | router | POST | `/account-security/email` |
| [backend/src/routes/oidcAuthRoutes.js:11](../../../backend/src/routes/oidcAuthRoutes.js#L11) | router | GET | `/account` |
| [backend/src/routes/oidcAuthRoutes.js:12](../../../backend/src/routes/oidcAuthRoutes.js#L12) | router | GET | `/csrf` |
| [backend/src/routes/oidcAuthRoutes.js:14](../../../backend/src/routes/oidcAuthRoutes.js#L14) | router | GET | `/organizations` |
| [backend/src/routes/oidcAuthRoutes.js:15](../../../backend/src/routes/oidcAuthRoutes.js#L15) | router | POST | `/organization` |
| [backend/src/routes/oidcAuthRoutes.js:16](../../../backend/src/routes/oidcAuthRoutes.js#L16) | router | GET | `/session` |
| [backend/src/routes/oidcAuthRoutes.js:18](../../../backend/src/routes/oidcAuthRoutes.js#L18) | router | GET | `/session` |
| [backend/src/routes/oidcAuthRoutes.js:23](../../../backend/src/routes/oidcAuthRoutes.js#L23) | router | POST | `/logout` |
| [backend/src/routes/organizationDashboardRoutes.js:21](../../../backend/src/routes/organizationDashboardRoutes.js#L21) | router | GET | `/:organizationId/dashboard/summary` |
| [backend/src/routes/organizationDirectoryRoutes.js:22](../../../backend/src/routes/organizationDirectoryRoutes.js#L22) | router | PUT | `/memberships/:id/status` |
| [backend/src/routes/organizationDirectoryRoutes.js:27](../../../backend/src/routes/organizationDirectoryRoutes.js#L27) | router | GET | `/matching` |
| [backend/src/routes/platformDirectoryRoutes.js:9](../../../backend/src/routes/platformDirectoryRoutes.js#L9) | router | GET | `/entities/:id/registration` |
| [backend/src/routes/platformDirectoryRoutes.js:10](../../../backend/src/routes/platformDirectoryRoutes.js#L10) | router | PUT | `/entities/:id/registration` |
| [backend/src/routes/platformDirectoryRoutes.js:20](../../../backend/src/routes/platformDirectoryRoutes.js#L20) | router | GET | `/entities` |
| [backend/src/routes/platformDirectoryRoutes.js:21](../../../backend/src/routes/platformDirectoryRoutes.js#L21) | router | GET | `/entities/:id` |
| [backend/src/routes/platformDirectoryRoutes.js:22](../../../backend/src/routes/platformDirectoryRoutes.js#L22) | router | GET | `/users` |
| [backend/src/routes/platformDirectoryRoutes.js:23](../../../backend/src/routes/platformDirectoryRoutes.js#L23) | router | GET | `/logs` |
| [backend/src/routes/platformDirectoryRoutes.js:24](../../../backend/src/routes/platformDirectoryRoutes.js#L24) | router | GET | `/dashboard` |
| [backend/src/routes/platformOnboardingRoutes.js:12](../../../backend/src/routes/platformOnboardingRoutes.js#L12) | router | GET | `/entities` |
| [backend/src/routes/platformOnboardingRoutes.js:13](../../../backend/src/routes/platformOnboardingRoutes.js#L13) | router | GET | `/entities/:id` |
| [backend/src/routes/platformOnboardingRoutes.js:14](../../../backend/src/routes/platformOnboardingRoutes.js#L14) | router | POST | `/entities` |
| [backend/src/routes/platformOnboardingRoutes.js:15](../../../backend/src/routes/platformOnboardingRoutes.js#L15) | router | POST | `/entities/:id/resume` |
| [backend/src/routes/platformOnboardingRoutes.js:16](../../../backend/src/routes/platformOnboardingRoutes.js#L16) | router | POST | `/entities/:id/invitations` |
| [backend/src/routes/platformOnboardingRoutes.js:17](../../../backend/src/routes/platformOnboardingRoutes.js#L17) | router | POST | `/entities/:id/invitations/:invitationId/revoke` |
| [backend/src/routes/platformOnboardingRoutes.js:18](../../../backend/src/routes/platformOnboardingRoutes.js#L18) | router | POST | `/activation/begin` |
| [backend/src/routes/platformOnboardingRoutes.js:19](../../../backend/src/routes/platformOnboardingRoutes.js#L19) | router | POST | `/activation/complete` |
| [backend/src/routes/privateOpportunityImportRoutes.js:27](../../../backend/src/routes/privateOpportunityImportRoutes.js#L27) | router | POST | `/xlsx` |
| [backend/src/routes/privateOpportunityImportRoutes.js:28](../../../backend/src/routes/privateOpportunityImportRoutes.js#L28) | router | GET | `/` |
| [backend/src/routes/privateOpportunityImportRoutes.js:29](../../../backend/src/routes/privateOpportunityImportRoutes.js#L29) | router | POST | `/:id/preview` |
| [backend/src/routes/privateOpportunityImportRoutes.js:30](../../../backend/src/routes/privateOpportunityImportRoutes.js#L30) | router | POST | `/:id/confirm` |
| [backend/src/routes/privateOpportunityImportRoutes.js:31](../../../backend/src/routes/privateOpportunityImportRoutes.js#L31) | router | POST | `/:id/cancel` |
| [backend/src/routes/privateOpportunityImportRoutes.js:32](../../../backend/src/routes/privateOpportunityImportRoutes.js#L32) | router | POST | `/:id/possible/:line/review` |
| [backend/src/routes/privateOpportunityImportRoutes.js:37](../../../backend/src/routes/privateOpportunityImportRoutes.js#L37) | router | GET | `/:id/report` |
| [backend/src/routes/privateOpportunityImportRoutes.js:38](../../../backend/src/routes/privateOpportunityImportRoutes.js#L38) | router | GET | `/:id` |
| [backend/src/routes/privateOpportunityRoutes.js:16](../../../backend/src/routes/privateOpportunityRoutes.js#L16) | router | GET | `/` |
| [backend/src/routes/privateOpportunityRoutes.js:18](../../../backend/src/routes/privateOpportunityRoutes.js#L18) | router | POST | `/` |
| [backend/src/routes/privateOpportunityRoutes.js:19](../../../backend/src/routes/privateOpportunityRoutes.js#L19) | router | POST | `/:id/archive` |
| [backend/src/routes/privateOpportunityRoutes.js:20](../../../backend/src/routes/privateOpportunityRoutes.js#L20) | router | GET | `/:id` |
| [backend/src/routes/privateOpportunityRoutes.js:24](../../../backend/src/routes/privateOpportunityRoutes.js#L24) | router | PUT | `/:id` |

| [backend/src/fundingTenders/http.js:54](../../../backend/src/fundingTenders/http.js#L54) | platformCatalog | POST | `/` |

## Declarações em tabelas de métodos

Caminhos relativos ao router do ficheiro. Uma declaração não prova montagem ou disponibilidade.

| Ficheiro e linha | Método | Caminho declarado |
|---|---|---|
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | GET | `/communication/context` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | GET | `/communication/history` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | GET | `/communication/:id` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | POST | `/communication` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | GET | `/` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | PATCH | `/read-all` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | PATCH | `/:id/read` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | POST | `/check-deadlines` |
| [backend/src/routes/applicationAlertRoutes.js:5](../../../backend/src/routes/applicationAlertRoutes.js#L5) | POST | `/refresh-list` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/report` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/report.csv` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/partners` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/:id/partners` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/:id/partners/history` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | POST | `/:id/partners` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | PUT | `/:id/partners` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | POST | `/:id/partners/remove` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/units` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/browse` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/browse-page` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/responsibles` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/opportunity-summaries` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | POST | `/` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/:id/work` |
| [backend/src/routes/applicationSliceRoutes.js:63](../../../backend/src/routes/applicationSliceRoutes.js#L63) | GET | `/:id/work/history` |
| [backend/src/routes/applicationSliceRoutes.js:64](../../../backend/src/routes/applicationSliceRoutes.js#L64) | POST | `/:id/work/participants` |
| [backend/src/routes/applicationSliceRoutes.js:64](../../../backend/src/routes/applicationSliceRoutes.js#L64) | POST | `/:id/work/participants/remove` |
| [backend/src/routes/applicationSliceRoutes.js:65](../../../backend/src/routes/applicationSliceRoutes.js#L65) | POST | `/:id/work/tasks` |
| [backend/src/routes/applicationSliceRoutes.js:65](../../../backend/src/routes/applicationSliceRoutes.js#L65) | PUT | `/:id/work/tasks` |
| [backend/src/routes/applicationSliceRoutes.js:65](../../../backend/src/routes/applicationSliceRoutes.js#L65) | POST | `/:id/work/tasks/complete` |
| [backend/src/routes/applicationSliceRoutes.js:65](../../../backend/src/routes/applicationSliceRoutes.js#L65) | POST | `/:id/work/tasks/cancel` |
| [backend/src/routes/applicationSliceRoutes.js:65](../../../backend/src/routes/applicationSliceRoutes.js#L65) | GET | `/:id/history` |
| [backend/src/routes/applicationSliceRoutes.js:66](../../../backend/src/routes/applicationSliceRoutes.js#L66) | GET | `/:id/documents/candidates` |
| [backend/src/routes/applicationSliceRoutes.js:66](../../../backend/src/routes/applicationSliceRoutes.js#L66) | GET | `/:id/documents/history` |
| [backend/src/routes/applicationSliceRoutes.js:66](../../../backend/src/routes/applicationSliceRoutes.js#L66) | GET | `/:id/documents` |
| [backend/src/routes/applicationSliceRoutes.js:67](../../../backend/src/routes/applicationSliceRoutes.js#L67) | POST | `/:id/documents/links` |
| [backend/src/routes/applicationSliceRoutes.js:67](../../../backend/src/routes/applicationSliceRoutes.js#L67) | POST | `/:id/documents/remove` |
| [backend/src/routes/applicationSliceRoutes.js:68](../../../backend/src/routes/applicationSliceRoutes.js#L68) | POST | `/:id/documents/reviews` |
| [backend/src/routes/applicationSliceRoutes.js:68](../../../backend/src/routes/applicationSliceRoutes.js#L68) | POST | `/:id/documents/reviews/decide` |
| [backend/src/routes/applicationSliceRoutes.js:69](../../../backend/src/routes/applicationSliceRoutes.js#L69) | POST | `/:id/transitions` |
| [backend/src/routes/applicationSliceRoutes.js:69](../../../backend/src/routes/applicationSliceRoutes.js#L69) | GET | `/:id` |
| [backend/src/routes/applicationSliceRoutes.js:69](../../../backend/src/routes/applicationSliceRoutes.js#L69) | PUT | `/:id` |
| [backend/src/routes/editorialProfileRoutes.js:13](../../../backend/src/routes/editorialProfileRoutes.js#L13) | POST | `/drafts/:id/submit` |
| [backend/src/routes/editorialProfileRoutes.js:14](../../../backend/src/routes/editorialProfileRoutes.js#L14) | POST | `/candidates/:id/approve` |
| [backend/src/routes/editorialProfileRoutes.js:15](../../../backend/src/routes/editorialProfileRoutes.js#L15) | POST | `/versions/:id/publish` |
| [backend/src/routes/editorialProfileRoutes.js:16](../../../backend/src/routes/editorialProfileRoutes.js#L16) | GET | `/candidates/:id` |
| [backend/src/routes/editorialProfileRoutes.js:17](../../../backend/src/routes/editorialProfileRoutes.js#L17) | GET | `/versions/:id` |
| [backend/src/routes/editorialUiRoutes.js:11](../../../backend/src/routes/editorialUiRoutes.js#L11) | GET | `/context` |
| [backend/src/routes/editorialUiRoutes.js:11](../../../backend/src/routes/editorialUiRoutes.js#L11) | GET | `/catalog` |
| [backend/src/routes/editorialUiRoutes.js:11](../../../backend/src/routes/editorialUiRoutes.js#L11) | POST | `/drafts` |
| [backend/src/routes/editorialUiRoutes.js:12](../../../backend/src/routes/editorialUiRoutes.js#L12) | PUT | `/drafts/:id` |
| [backend/src/routes/editorialUiRoutes.js:12](../../../backend/src/routes/editorialUiRoutes.js#L12) | POST | `/drafts/:id/submit` |
| [backend/src/routes/editorialUiRoutes.js:12](../../../backend/src/routes/editorialUiRoutes.js#L12) | POST | `/candidates/:id/approve` |
| [backend/src/routes/editorialUiRoutes.js:13](../../../backend/src/routes/editorialUiRoutes.js#L13) | POST | `/versions/:id/publish` |
| [backend/src/routes/editorialUiRoutes.js:13](../../../backend/src/routes/editorialUiRoutes.js#L13) | POST | `/intentions/lookup` |
| [backend/src/routes/editorialUiRoutes.js:14](../../../backend/src/routes/editorialUiRoutes.js#L14) | GET | `/` |
| [backend/src/routes/editorialUiRoutes.js:14](../../../backend/src/routes/editorialUiRoutes.js#L14) | GET | `/` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | GET | `/` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | GET | `/catalog` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | GET | `/revisions` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | GET | `/revisions/:revisionId` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | POST | `/revisions` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | POST | `/revisions/:revisionId/confirm` |
| [backend/src/routes/opportunityCriteriaRoutes.js:5](../../../backend/src/routes/opportunityCriteriaRoutes.js#L5) | POST | `/intentions/lookup` |
| [backend/src/routes/opportunityInterestRoutes.js:19](../../../backend/src/routes/opportunityInterestRoutes.js#L19) | GET | `/context` |
| [backend/src/routes/opportunityInterestRoutes.js:19](../../../backend/src/routes/opportunityInterestRoutes.js#L19) | GET | `/units` |
| [backend/src/routes/opportunityInterestRoutes.js:19](../../../backend/src/routes/opportunityInterestRoutes.js#L19) | GET | `/summaries` |
| [backend/src/routes/opportunityInterestRoutes.js:19](../../../backend/src/routes/opportunityInterestRoutes.js#L19) | GET | `/` |
| [backend/src/routes/opportunityInterestRoutes.js:19](../../../backend/src/routes/opportunityInterestRoutes.js#L19) | POST | `/` |
| [backend/src/routes/opportunityInterestRoutes.js:20](../../../backend/src/routes/opportunityInterestRoutes.js#L20) | GET | `/:id/history` |
| [backend/src/routes/opportunityInterestRoutes.js:20](../../../backend/src/routes/opportunityInterestRoutes.js#L20) | POST | `/:id/archive` |
| [backend/src/routes/opportunityInterestRoutes.js:20](../../../backend/src/routes/opportunityInterestRoutes.js#L20) | GET | `/:id` |
| [backend/src/routes/opportunityInterestRoutes.js:20](../../../backend/src/routes/opportunityInterestRoutes.js#L20) | PUT | `/:id` |
| [backend/src/routes/organizationDirectoryRoutes.js:15](../../../backend/src/routes/organizationDirectoryRoutes.js#L15) | GET | `/access` |
| [backend/src/routes/organizationDirectoryRoutes.js:15](../../../backend/src/routes/organizationDirectoryRoutes.js#L15) | PUT | `/memberships/:id/profile` |
| [backend/src/routes/organizationDirectoryRoutes.js:15](../../../backend/src/routes/organizationDirectoryRoutes.js#L15) | PUT | `/memberships/:id/billing` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | PUT | `/description` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | PUT | `/registration` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | PUT | `/registration/contacts` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | GET | `/` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | PUT | `/` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | GET | `/units` |
| [backend/src/routes/organizationDirectoryRoutes.js:32](../../../backend/src/routes/organizationDirectoryRoutes.js#L32) | POST | `/units` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/units/:id/name` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/units/:id/parent` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | GET | `/me` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/me` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | GET | `/memberships` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | GET | `/people/:id` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/people/:id/profile` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/people/:id/account` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | GET | `/people` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | POST | `/people` |
| [backend/src/routes/organizationDirectoryRoutes.js:33](../../../backend/src/routes/organizationDirectoryRoutes.js#L33) | PUT | `/people/:id` |
| [backend/src/routes/platformDirectoryRoutes.js:11](../../../backend/src/routes/platformDirectoryRoutes.js#L11) | GET | `/entities/:id/access` |
| [backend/src/routes/platformDirectoryRoutes.js:11](../../../backend/src/routes/platformDirectoryRoutes.js#L11) | PUT | `/entities/:id/memberships/:membershipId/profile` |
| [backend/src/routes/platformDirectoryRoutes.js:11](../../../backend/src/routes/platformDirectoryRoutes.js#L11) | PUT | `/entities/:id/memberships/:membershipId/status` |
| [backend/src/routes/pq1ActivationRoutes.js:7](../../../backend/src/routes/pq1ActivationRoutes.js#L7) | POST | `/:opportunityId/prequalifications` |
| [backend/src/routes/pq1ActivationRoutes.js:7](../../../backend/src/routes/pq1ActivationRoutes.js#L7) | GET | `/prequalifications/:id` |
| [backend/src/routes/pq1ActivationRoutes.js:7](../../../backend/src/routes/pq1ActivationRoutes.js#L7) | POST | `/prequalifications/:id/decisions` |
| [backend/src/routes/pq1ActivationRoutes.js:7](../../../backend/src/routes/pq1ActivationRoutes.js#L7) | GET | `/prequalifications/:id/decisions` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | GET | `/context` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | POST | `/preview` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | POST | `/activate` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | GET | `/active` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | GET | `/snapshots/:id` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | GET | `/activations` |
| [backend/src/routes/pq1ActivationRoutes.js:8](../../../backend/src/routes/pq1ActivationRoutes.js#L8) | POST | `/intentions/lookup` |
| [backend/src/routes/pq1UiRoutes.js:11](../../../backend/src/routes/pq1UiRoutes.js#L11) | GET | `/context` |
| [backend/src/routes/pq1UiRoutes.js:11](../../../backend/src/routes/pq1UiRoutes.js#L11) | GET | `/catalog` |
| [backend/src/routes/pq1UiRoutes.js:11](../../../backend/src/routes/pq1UiRoutes.js#L11) | POST | `/drafts` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | PUT | `/drafts/:id/items` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | PUT | `/drafts/:id/competencies` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | PUT | `/drafts/:id/experiences` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | POST | `/drafts/:id/evidence-links` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | POST | `/drafts/:id/verifications` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | POST | `/verifications/:id/revoke` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | GET | `/drafts/:id/revisions/:revision` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | GET | `/drafts/:id/experiences/:experienceId/documents` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | POST | `/drafts/:id/submit` |
| [backend/src/routes/pq1UiRoutes.js:12](../../../backend/src/routes/pq1UiRoutes.js#L12) | POST | `/candidates/:id/approve` |
| [backend/src/routes/pq1UiRoutes.js:13](../../../backend/src/routes/pq1UiRoutes.js#L13) | POST | `/versions/:id/publish` |
| [backend/src/routes/pq1UiRoutes.js:13](../../../backend/src/routes/pq1UiRoutes.js#L13) | POST | `/intentions/lookup` |
| [backend/src/routes/pq1UiRoutes.js:14](../../../backend/src/routes/pq1UiRoutes.js#L14) | GET | `/` |
| [backend/src/routes/pq1UiRoutes.js:14](../../../backend/src/routes/pq1UiRoutes.js#L14) | GET | `/` |
