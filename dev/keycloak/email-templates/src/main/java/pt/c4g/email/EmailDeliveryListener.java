package pt.c4g.email;

import org.keycloak.Config;
import org.keycloak.connections.jpa.JpaConnectionProvider;
import org.keycloak.events.Details;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.events.EventType;
import org.keycloak.events.admin.AdminEvent;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

/** Observes native reset-email outcomes. Does not participate in authentication. */
public final class EmailDeliveryListener implements EventListenerProviderFactory {
    public static final String ID = "c4g-email-delivery";
    public static final long RETENTION_MS = 90L * 24 * 60 * 60 * 1000;
    @Override public String getId() { return ID; }
    @Override public void init(Config.Scope config) { }
    @Override public void postInit(KeycloakSessionFactory factory) {
        factory.register(event -> {
            if (event instanceof org.keycloak.models.utils.PostMigrationEvent) {
                try (var session = factory.create()) {
                    session.getProvider(org.keycloak.timer.TimerProvider.class).scheduleTask(taskSession -> {
                        taskSession.getProvider(JpaConnectionProvider.class).getEntityManager()
                            .createQuery("update EmailDelivery d set d.recipient = null where d.recipient is not null and d.occurredAt <= :cutoff")
                            .setParameter("cutoff", System.currentTimeMillis() - RETENTION_MS).executeUpdate();
                    }, 60000L, "c4g-email-delivery-retention");
                }
            }
        });
    }
    @Override public void close() { }
    @Override public EventListenerProvider create(KeycloakSession session) {
        return new EventListenerProvider() {
            @Override public void onEvent(Event event) {
                boolean accepted = event.getType() == EventType.SEND_RESET_PASSWORD;
                if (!accepted && event.getType() != EventType.SEND_RESET_PASSWORD_ERROR) return;
                if (event.getId() == null || event.getRealmId() == null) return;
                var em = session.getProvider(JpaConnectionProvider.class).getEntityManager();
                var key = new EmailDelivery.Key(event.getId(), event.getRealmId());
                if (em.find(EmailDelivery.class, key) != null) return;
                EmailDelivery row = new EmailDelivery();
                row.id = event.getId(); row.realmId = event.getRealmId();
                row.occurredAt = event.getTime();
                row.result = accepted ? "ACCEPTED" : "UNCONFIRMED";
                // Success carries the actual recipient. Failure events omit it;
                // resolve only now, never from the account when listing history.
                String recipient = event.getDetails() == null ? null : event.getDetails().get(Details.EMAIL);
                if (recipient == null && !accepted && event.getUserId() != null) {
                    var realm = session.realms().getRealm(event.getRealmId());
                    var user = realm == null ? null : session.users().getUserById(realm, event.getUserId());
                    recipient = user == null ? null : user.getEmail();
                }
                row.recipient = recipient != null && recipient.length() <= 254
                    && recipient.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")
                    && row.occurredAt > System.currentTimeMillis() - RETENTION_MS ? recipient : null;
                em.persist(row);
            }
            @Override public void onEvent(AdminEvent event, boolean includeRepresentation) { }
            @Override public void close() { }
        };
    }
}
