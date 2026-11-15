package pt.c4g.email;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.MessageFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TemplateContract {
    static final int MAX_BYTES = 262144;
    static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    static final Set<String> MESSAGE_KEYS = Set.of("passwordResetSubject", "passwordResetBody", "passwordResetBodyHtml");
    static final Set<String> BODY_VARIABLES = Set.of("LigacaoRecuperacao", "Validade", "Logotipo");
    static final Set<String> TAGS = Set.of("p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a");
    static final Set<String> BLOCKS = Set.of("p", "h1", "h2", "h3", "ul", "ol");
    static final Pattern UUID = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", Pattern.CASE_INSENSITIVE);
    static final Pattern VARIABLE = Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*)\\}");
    static final Pattern COMPILE_VARIABLE = Pattern.compile("\\{(LigacaoRecuperacao|Validade|Logotipo)\\}");
    static final Pattern TAG = Pattern.compile("<(/?)([a-z][a-z0-9]*)([^<>]*)>");
    static final Pattern HREF = Pattern.compile("\\s+href=\"([^\"]*)\"\\s*");
    static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f]");
    // ECMAScript whitespace, including NBSP/BOM but excluding Unicode NEL.
    static final String JS_SPACE = "[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
    static final String DEFAULT_SUBJECT = "Recupere o acesso à C4G";
    static final String DEFAULT_HTML = "<p>{Logotipo}</p><p>Recebemos um pedido para alterar a palavra-passe da sua conta C4G.</p>"
        + "<p><a href=\"{LigacaoRecuperacao}\">Definir uma nova palavra-passe</a></p>"
        + "<p>Esta ligação é de uso único e é válida durante {Validade}.</p>"
        + "<p>Se não fez este pedido, ignore este email. A sua palavra-passe mantém-se.</p>";

    record Input(JsonNode json, String action, long expectedRevision, String requestId, String actorId,
                 String subject, String html, Map<String, String> messages, String logoUrl, String digest) { }

    static Input parse(byte[] bytes) throws Exception {
        require(bytes.length > 0 && bytes.length <= MAX_BYTES);
        JsonNode node = JSON.readTree(bytes);
        keys(node, Set.of("action", "expectedRevision", "idempotencyKey", "actorId", "template", "messages", "logoUrl"));
        String action = string(node.get("action"), 5);
        require(action.equals("SAVE") || action.equals("RESET"));
        JsonNode revision = node.get("expectedRevision");
        require(revision.isIntegralNumber() && revision.canConvertToInt() && revision.intValue() >= 0 && revision.intValue() <= Integer.MAX_VALUE - 2);
        String requestId = string(node.get("idempotencyKey"), 36);
        String actorId = string(node.get("actorId"), 36);
        require(UUID.matcher(requestId).matches() && UUID.matcher(actorId).matches());
        requestId = requestId.toLowerCase(java.util.Locale.ROOT);
        actorId = actorId.toLowerCase(java.util.Locale.ROOT);
        ((ObjectNode) node).put("idempotencyKey", requestId).put("actorId", actorId);
        keys(node.get("template"), Set.of("subject", "html"));
        String subject = string(node.get("template").get("subject"), 200);
        String html = string(node.get("template").get("html"), 20000);
        require(subject.equals(trim(subject)) && !CONTROL.matcher(subject).find());
        if (action.equals("RESET")) require(subject.equals(DEFAULT_SUBJECT) && html.equals(DEFAULT_HTML));
        require(!subject.contains("[[C4G_ACTIVATION_LINK]]") && !html.contains("[[C4G_ACTIVATION_LINK]]"));
        require(!VARIABLE.matcher(subject).find());
        Matcher variables = VARIABLE.matcher(html);
        while (variables.find()) require(BODY_VARIABLES.contains(variables.group(1)));
        validateHtml(html);
        String text = text(html);
        require(text.contains("{LigacaoRecuperacao}") && text.contains("{Validade}"));
        String logoUrl = null;
        if (!node.get("logoUrl").isNull()) {
            logoUrl = string(node.get("logoUrl"), 2048);
            require(https(logoUrl) && !new URI(logoUrl).getRawPath().isEmpty() && new URI(logoUrl).getRawFragment() == null);
        }
        keys(node.get("messages"), MESSAGE_KEYS);
        Map<String, String> messages = new TreeMap<>();
        for (String key : MESSAGE_KEYS) messages.put(key, string(node.get("messages").get(key), key.equals("passwordResetSubject") ? 450 : 100000));
        String logo = logoUrl == null ? "" : "<img src=\"" + escape(logoUrl) + "\" alt=\"C4G\">";
        require(messages.get("passwordResetSubject").equals(literal(subject)));
        require(messages.get("passwordResetBody").equals(compile(trim(text.replace("{Logotipo}", "")), "")));
        require(messages.get("passwordResetBodyHtml").equals(compile(html, logo)));
        for (String key : MESSAGE_KEYS) {
            MessageFormat format = new MessageFormat(messages.get(key));
            String rendered = format.format(new Object[] { "C4G_LINK_ARGUMENT", "C4G_FORBIDDEN_1", "C4G_FORBIDDEN_2", "C4G_VALIDITY_ARGUMENT" });
            if (!key.equals("passwordResetSubject")) require(rendered.contains("C4G_LINK_ARGUMENT") && rendered.contains("C4G_VALIDITY_ARGUMENT"));
            require(!rendered.contains("C4G_FORBIDDEN_1") && !rendered.contains("C4G_FORBIDDEN_2"));
        }
        String canonical = JSON.writeValueAsString(sorted(node));
        String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
        return new Input(node, action, revision.longValue(), requestId, actorId, subject, html, messages, logoUrl, digest);
    }

    static void require(boolean value) {
        if (!value) throw new IllegalArgumentException("INVALID_INPUT");
    }
    static String string(JsonNode value, int maximum) {
        require(value != null && value.isTextual() && !value.textValue().isEmpty() && value.textValue().length() <= maximum);
        return value.textValue();
    }
    static void keys(JsonNode value, Set<String> expected) {
        require(value != null && value.isObject() && value.size() == expected.size());
        value.fieldNames().forEachRemaining(name -> require(expected.contains(name)));
    }
    private static JsonNode sorted(JsonNode value) {
        if (!value.isObject()) return value;
        ObjectNode result = JSON.createObjectNode();
        List<String> fields = new ArrayList<>();
        value.fieldNames().forEachRemaining(fields::add);
        fields.stream().sorted().forEach(name -> result.set(name, sorted(value.get(name))));
        return result;
    }
    static boolean https(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
    static String decode(String value) {
        return value.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
    }
    static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }
    static String literal(String value) { return value.isEmpty() ? "" : "'" + value.replace("'", "''") + "'"; }
    static String trim(String value) { return value.replaceAll("^" + JS_SPACE + "+|" + JS_SPACE + "+$", ""); }
    static String compile(String value, String logo) {
        Matcher matcher = COMPILE_VARIABLE.matcher(value);
        StringBuilder result = new StringBuilder(), pending = new StringBuilder();
        int position = 0;
        while (matcher.find()) {
            pending.append(value, position, matcher.start());
            if (matcher.group(1).equals("Logotipo")) pending.append(logo);
            else {
                result.append(literal(pending.toString())).append(matcher.group(1).equals("LigacaoRecuperacao") ? "{0}" : "{3}");
                pending.setLength(0);
            }
            position = matcher.end();
        }
        return result.append(literal(pending.append(value.substring(position)).toString())).toString();
    }
    static void validateHtml(String html) {
        Matcher matcher = TAG.matcher(html);
        int position = 0;
        ArrayDeque<String> stack = new ArrayDeque<>();
        while (matcher.find()) {
            require(!html.substring(position, matcher.start()).contains("<") && !html.substring(position, matcher.start()).contains(">"));
            String name = matcher.group(2), attrs = matcher.group(3);
            boolean closing = matcher.group(1).equals("/");
            require(TAGS.contains(name));
            if (closing) {
                require(attrs.isEmpty() && !stack.isEmpty() && stack.pop().equals(name));
            } else {
                if (!attrs.isEmpty()) {
                    Matcher href = HREF.matcher(attrs);
                    if (name.equals("br") && attrs.equals(" /")) { /* sanitizer's void element */ }
                    else {
                        require(name.equals("a") && href.matches());
                        String address = decode(href.group(1));
                        require(address.equals("{LigacaoRecuperacao}") || https(address));
                    }
                }
                if (!name.equals("br")) stack.push(name);
            }
            position = matcher.end();
        }
        require(stack.isEmpty() && !html.substring(position).contains("<") && !html.substring(position).contains(">"));
    }
    private static final class ListState { boolean ordered; int count; ListState(boolean ordered) { this.ordered = ordered; } }
    private record Link(String href, int start) { }
    private static void stripSpaces(StringBuilder value) {
        while (!value.isEmpty() && (value.charAt(value.length() - 1) == ' ' || value.charAt(value.length() - 1) == '\t')) value.setLength(value.length() - 1);
    }
    private static void block(StringBuilder value) {
        stripSpaces(value);
        if (!value.isEmpty() && !value.toString().endsWith("\n\n")) value.append(value.toString().endsWith("\n") ? "\n" : "\n\n");
    }
    private static void line(StringBuilder value) {
        stripSpaces(value);
        if (!value.isEmpty() && !value.toString().endsWith("\n")) value.append('\n');
    }
    private static void appendText(StringBuilder result, String value) {
        String chunk = decode(value).replaceAll(JS_SPACE + "+", " ");
        if (result.isEmpty() || result.toString().endsWith("\n") || result.toString().endsWith(" ")) chunk = chunk.replaceFirst("^ ", "");
        result.append(chunk);
    }
    static String text(String html) {
        StringBuilder result = new StringBuilder();
        ArrayDeque<ListState> lists = new ArrayDeque<>();
        ArrayDeque<Link> links = new ArrayDeque<>();
        Matcher matcher = TAG.matcher(html);
        int position = 0;
        while (matcher.find()) {
            appendText(result, html.substring(position, matcher.start()));
            position = matcher.end();
            String name = matcher.group(2);
            boolean closing = matcher.group(1).equals("/");
            if (name.equals("br")) { stripSpaces(result); result.append('\n'); }
            else if (name.equals("li")) {
                if (!closing) { line(result); result.append(!lists.isEmpty() && lists.peek().ordered ? (++lists.peek().count) + ". " : "- "); }
            } else if (name.equals("a")) {
                if (!closing) {
                    Matcher href = HREF.matcher(matcher.group(3));
                    links.push(new Link(href.matches() ? decode(href.group(1)) : null, result.length()));
                } else {
                    Link link = links.pop();
                    if (link.href() != null) {
                        String label = trim(result.substring(link.start()));
                        if (label.isEmpty()) result.append(link.href());
                        else if (!label.equals(link.href())) result.append(": ").append(link.href());
                    }
                }
            } else if (BLOCKS.contains(name)) {
                if (name.equals("ul") || name.equals("ol")) {
                    if (closing) { if (!lists.isEmpty()) lists.pop(); }
                    else lists.push(new ListState(name.equals("ol")));
                }
                block(result);
            }
        }
        appendText(result, html.substring(position));
        String[] rows = result.toString().split("\n", -1);
        for (int i = 0; i < rows.length; i++) rows[i] = rows[i].replaceAll(JS_SPACE + "+$", "");
        return trim(String.join("\n", rows).replaceAll("\\n{3,}", "\n\n"));
    }
}
