package pt.c4g.proof;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import org.keycloak.util.JsonSerialization;

// Isolated feasibility probe: hard-bound to the disposable harness, not a production SPI.
final class Bridge {
 static String check(String ticket, String subject) {
  if (ticket == null || !ticket.matches("[a-f0-9]{64}")) throw new IllegalStateException("INVITATION_UNAVAILABLE");
  try {
   var req = HttpRequest.newBuilder(URI.create("http://host.docker.internal:5283/bridge/check"))
    .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
    .header("X-Proof-Bridge", System.getenv("C4G_PROOF_BRIDGE_SECRET"))
    .POST(HttpRequest.BodyPublishers.ofString(JsonSerialization.writeValueAsString(Map.of("ticket",ticket,"subject",subject == null ? "" : subject)))).build();
   var res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
   if (res.statusCode() != 200 || !res.body().matches("[a-f0-9-]{36}")) throw new IllegalStateException();
   return res.body();
  } catch (Exception e) { throw new IllegalStateException("INVITATION_UNAVAILABLE"); }
 }
}
