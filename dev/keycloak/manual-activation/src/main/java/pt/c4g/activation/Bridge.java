package pt.c4g.activation;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import java.util.Properties;
import java.nio.file.Files;
import java.nio.file.Path;
import org.keycloak.util.JsonSerialization;

// Explicit local installation allowlist. Passwords remain native Keycloak data.
final class Bridge {
 static String check(String ticket, String subject, String realm, String client) {
  if (ticket == null || !ticket.matches("[a-f0-9]{64}")) throw new IllegalStateException("INVITATION_UNAVAILABLE");
  try {
   var config=new Properties();
   try(var stream=Files.newInputStream(Path.of("/opt/keycloak/conf/c4g-activation.properties"))){config.load(stream);}
   if(!realm.equals(config.getProperty("realm")) || !client.equals(config.getProperty("client"))) throw new IllegalStateException();
   String secret=config.getProperty("secret");
   if(secret==null || !secret.matches("[a-f0-9]{64}")) throw new IllegalStateException();
   URI endpoint=URI.create(config.getProperty("endpoint"));
   boolean isolatedPort=realm.equals("c4g-manual-proof") && endpoint.getPort()==5295;
   if(!endpoint.getHost().equals("host.docker.internal") || !endpoint.getScheme().equals("http") || (endpoint.getPort()!=5285 && !isolatedPort) || !endpoint.getPath().equals("/bridge/check") || endpoint.getQuery()!=null || endpoint.getUserInfo()!=null) throw new IllegalStateException();
   var req = HttpRequest.newBuilder(endpoint)
    .timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
    .header("X-C4G-Activation", secret)
    .POST(HttpRequest.BodyPublishers.ofString(JsonSerialization.writeValueAsString(Map.of("ticket",ticket,"subject",subject == null ? "" : subject)))).build();
   var res = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
   if (res.statusCode() != 200 || !res.body().matches("[a-f0-9-]{36}")) throw new IllegalStateException();
   return res.body();
  } catch (Exception e) { throw new IllegalStateException("INVITATION_UNAVAILABLE"); }
 }
}
