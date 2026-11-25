package pt.c4g.email;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;

/** Offline cross-runtime parity/security probe. No mail, network or realm. */
public final class ContractProbe {
    public static void main(String[] args) throws Exception {
        JsonNode fixtures = TemplateContract.JSON.readTree(System.in.readAllBytes());
        int failures = 0;
        String canonicalDigest = null;
        for (JsonNode fixture : fixtures) {
            boolean accepted;
            String digest = null;
            try {
                byte[] request = fixture.has("raw") ? fixture.get("raw").textValue().getBytes(StandardCharsets.UTF_8)
                    : TemplateContract.JSON.writeValueAsBytes(fixture.get("input"));
                digest = TemplateContract.parse(request).digest();
                accepted = true;
            } catch (Exception rejected) { accepted = false; }
            boolean passed = accepted == fixture.get("accepted").booleanValue();
            if (fixture.has("canonicalDigest")) canonicalDigest = digest;
            if (fixture.has("sameDigest")) passed &= digest != null && digest.equals(canonicalDigest);
            if (!passed) failures++;
            System.out.println((passed ? "PASS " : "FAIL ") + fixture.get("name").textValue());
        }
        if (failures != 0) throw new IllegalStateException("Contract cases failed: " + failures);
    }
}
