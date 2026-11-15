package pt.c4g.email;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HEAD;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.keycloak.connections.jpa.JpaConnectionProvider;
import org.keycloak.models.ClientModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.models.cache.CachedRealmModel;
import org.keycloak.models.jpa.entities.RealmEntity;
import org.keycloak.models.jpa.entities.RealmLocalizationTextsEntity;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager.AuthResult;

/** Only password-reset text publication; no generic realm or localization API. */
@Provider
@Produces(MediaType.APPLICATION_JSON)
public final class EmailResource {
    private static final String CLIENT = "c4g-email-templates";
    private static final String ROLE = "publish-password-reset";
    private final KeycloakSession session;
    private String serviceActorId;
    public EmailResource(KeycloakSession session) { this.session = session; }

    private static final class Refused extends RuntimeException {
        final int status;
        final String code;
        Refused(int status, String code) { super(code); this.status = status; this.code = code; }
    }
    private static void require(boolean condition, int status, String code) {
        if (!condition) throw new Refused(status, code);
    }
    private Response response(int status, Object value) {
        return Response.status(status).entity(value).header("Cache-Control", "no-store")
            .header("Referrer-Policy", "no-referrer").build();
    }
    @FunctionalInterface private interface Work { Object run() throws Exception; }
    private Response handle(Work work) {
        try {
            authenticate();
            require(session.getContext().getUri().getQueryParameters().isEmpty(), 400, "INVALID_INPUT");
            return response(200, work.run());
        } catch (Refused refused) {
            session.getTransactionManager().setRollbackOnly();
            return response(refused.status, Map.of("code", refused.code));
        } catch (IllegalArgumentException invalid) {
            session.getTransactionManager().setRollbackOnly();
            return response(400, Map.of("code", "INVALID_INPUT"));
        } catch (Exception unavailable) {
            // No provider payload, SQL error, stack or token is logged/returned.
            session.getTransactionManager().setRollbackOnly();
            return response(503, Map.of("code", "EMAIL_PUBLICATION_UNAVAILABLE"));
        }
    }
    private void authenticate() {
        RealmModel realm = session.getContext().getRealm();
        List<String> headers = session.getContext().getRequestHeaders().getRequestHeader("Authorization");
        require(headers != null && headers.size() == 1, 401, "NOT_AUTHORIZED");
        AuthResult auth;
        try {
            auth = new AppAuthManager.BearerTokenAuthenticator(session).setRealm(realm).setAudience(CLIENT).authenticate();
        } catch (RuntimeException rejected) { throw new Refused(401, "NOT_AUTHORIZED"); }
        require(auth != null, 401, "NOT_AUTHORIZED");
        ClientModel client = session.clients().getClientByClientId(realm, CLIENT);
        require(client != null && client.isEnabled() && client.isServiceAccountsEnabled() && !client.isPublicClient(), 403, "NOT_AUTHORIZED");
        require(auth.user() != null && auth.user().isEnabled() && client.getId().equals(auth.user().getServiceAccountClientLink()), 403, "NOT_AUTHORIZED");
        require(CLIENT.equals(auth.token().getIssuedFor()) && auth.client() != null && client.getId().equals(auth.client().getId()), 403, "NOT_AUTHORIZED");
        RoleModel role = client.getRole(ROLE);
        require(role != null && auth.user().hasRole(role), 403, "NOT_AUTHORIZED");
        var access = auth.token().getResourceAccess(CLIENT);
        require(access != null && access.isUserInRole(ROLE), 403, "NOT_AUTHORIZED");
        serviceActorId = auth.user().getId();
    }
    private EntityManager entityManager() { return session.getProvider(JpaConnectionProvider.class).getEntityManager(); }

    /** Stable database lock includes first-write races; no in-memory mutex. */
    private RealmModel lockedRealm(EntityManager em) {
        RealmModel contextRealm = session.getContext().getRealm();
        RealmEntity entity = em.find(RealmEntity.class, contextRealm.getId(), LockModeType.PESSIMISTIC_WRITE);
        require(entity != null, 503, "EMAIL_PUBLICATION_UNAVAILABLE");
        // Authentication can have touched cached realm state before the lock.
        // Refresh storage first, then obtain the update delegate to register cache invalidation.
        em.refresh(entity, LockModeType.PESSIMISTIC_WRITE);
        RealmModel realm = contextRealm instanceof CachedRealmModel cached ? cached.getDelegateForUpdate() : contextRealm;
        // Localizations are separate entities; refresh any previously loaded rows too.
        List<RealmLocalizationTextsEntity> rows = em.createQuery(
            "select l from RealmLocalizationTextsEntity l where l.realm.id = :realm", RealmLocalizationTextsEntity.class)
            .setParameter("realm", realm.getId()).getResultList();
        rows.forEach(em::refresh);
        return realm;
    }
    @GET @Path("password-reset")
    public Response get() {
        return handle(() -> {
            var headers = session.getContext().getRequestHeaders();
            require(headers.getHeaderString("Transfer-Encoding") == null
                && (headers.getHeaderString("Content-Length") == null || "0".equals(headers.getHeaderString("Content-Length"))), 400, "INVALID_INPUT");
            EntityManager em = entityManager();
            RealmModel realm = lockedRealm(em);
            EmailHead head = em.find(EmailHead.class, realm.getId());
            if (head == null) {
                refuseDrift(realm, null, locales(realm));
                return Map.of("revision", 0, "configured", false);
            }
            EmailVersion version = em.find(EmailVersion.class, head.versionId);
            require(version != null && version.realmId.equals(realm.getId()) && version.revision == head.revision, 503, "EMAIL_PUBLICATION_UNAVAILABLE");
            refuseDrift(realm, version, locales(realm));
            return view(version);
        });
    }
    @HEAD @Path("password-reset")
    public Response head() { return handle(() -> { throw new Refused(405, "OPERATION_NOT_AVAILABLE"); }); }
    @PUT @Path("password-reset") @Consumes(MediaType.APPLICATION_JSON)
    public Response put(InputStream stream) {
        return handle(() -> {
            TemplateContract.Input input;
            try { input = TemplateContract.parse(stream.readNBytes(TemplateContract.MAX_BYTES + 1)); }
            catch (Exception invalid) { throw new Refused(400, "INVALID_INPUT"); }
            EntityManager em = entityManager();
            RealmModel realm = lockedRealm(em);
            EmailHead head = em.find(EmailHead.class, realm.getId());
            List<EmailVersion> receipts = em.createQuery(
                "select v from EmailVersion v where v.realmId = :realm and v.requestId = :request", EmailVersion.class)
                .setParameter("realm", realm.getId()).setParameter("request", input.requestId()).setMaxResults(1).getResultList();
            if (!receipts.isEmpty()) {
                EmailVersion receipt = receipts.get(0);
                require(receipt.requestSha256.equals(input.digest()), 409, "IDEMPOTENCY_CONFLICT");
                require(head != null && receipt.id.equals(head.versionId) && receipt.revision == head.revision, 409, "STALE_REVISION");
                refuseDrift(realm, receipt, locales(realm));
                return view(receipt);
            }
            long revision = head == null ? 0 : head.revision;
            require(input.expectedRevision() == revision, 409, "STALE_REVISION");
            require(revision < Integer.MAX_VALUE - 1, 409, "STALE_REVISION");
            List<String> locales = locales(realm);
            EmailVersion previous = head == null ? null : em.find(EmailVersion.class, head.versionId);
            if (head != null) require(previous != null && previous.realmId.equals(realm.getId()), 503, "EMAIL_PUBLICATION_UNAVAILABLE");
            refuseDrift(realm, previous, locales);
            for (String locale : locales) realm.createOrUpdateRealmLocalizationTexts(locale, input.messages());
            EmailVersion next = new EmailVersion();
            next.id = UUID.randomUUID().toString(); next.realmId = realm.getId(); next.revision = revision + 1;
            next.requestId = input.requestId(); next.requestSha256 = input.digest(); next.actorId = input.actorId();
            next.serviceActorId = serviceActorId;
            next.createdAt = System.currentTimeMillis();
            next.payloadJson = TemplateContract.JSON.writeValueAsString(input.json());
            next.localesJson = TemplateContract.JSON.writeValueAsString(locales);
            em.persist(next);
            if (head == null) {
                head = new EmailHead(); head.realmId = realm.getId();
                head.revision = next.revision; head.versionId = next.id;
                em.persist(head);
            } else { head.revision = next.revision; head.versionId = next.id; }
            em.flush();
            return view(next);
        });
    }
    private List<String> locales(RealmModel realm) {
        Set<String> result = new TreeSet<>();
        result.add("en");
        if (realm.getDefaultLocale() != null && !realm.getDefaultLocale().isBlank()) result.add(realm.getDefaultLocale());
        realm.getSupportedLocalesStream().forEach(result::add);
        require(result.size() <= 32 && result.stream().allMatch(value -> {
            if (!value.matches("[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}")) return false;
            Locale locale = Locale.forLanguageTag(value);
            return !locale.getLanguage().isEmpty() && !locale.toLanguageTag().equals("und") && locale.toLanguageTag().equals(value);
        }), 409, "EMAIL_PUBLICATION_DRIFT");
        return new ArrayList<>(result);
    }
    private void refuseDrift(RealmModel realm, EmailVersion previous, List<String> locales) throws Exception {
        Map<String, String> expected = new LinkedHashMap<>();
        if (previous != null) {
            JsonNode oldLocales = TemplateContract.JSON.readTree(previous.localesJson);
            require(oldLocales.equals(TemplateContract.JSON.valueToTree(locales)), 409, "EMAIL_PUBLICATION_DRIFT");
            JsonNode messages = TemplateContract.JSON.readTree(previous.payloadJson).get("messages");
            for (String key : TemplateContract.MESSAGE_KEYS) expected.put(key, messages.get(key).textValue());
        }
        for (String locale : locales) {
            Map<String, String> actual = realm.getRealmLocalizationTextsByLocale(locale);
            for (String key : TemplateContract.MESSAGE_KEYS) {
                if (previous == null) require(!actual.containsKey(key), 409, "EMAIL_PUBLICATION_DRIFT");
                else require(expected.get(key).equals(actual.get(key)), 409, "EMAIL_PUBLICATION_DRIFT");
            }
        }
    }
    private Map<String, Object> view(EmailVersion version) throws Exception {
        JsonNode input = TemplateContract.JSON.readTree(version.payloadJson);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("revision", version.revision); result.put("configured", true);
        result.put("action", input.get("action").textValue()); result.put("actorId", version.actorId);
        result.put("updatedAt", Instant.ofEpochMilli(version.createdAt).toString());
        result.put("template", input.get("template")); result.put("messages", input.get("messages"));
        result.put("logoUrl", input.get("logoUrl").isNull() ? null : input.get("logoUrl").textValue());
        return result;
    }
}
