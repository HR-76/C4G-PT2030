import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.util.Base64;
import java.util.Locale;
import java.util.Scanner;

// Local-only probe using Java's actual formatter, as Keycloak does.
class MessageFormatProbe {
    static String decode(String value) {
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }
    public static void main(String[] args) {
        int count = 0;
        try (Scanner input = new Scanner(System.in, StandardCharsets.UTF_8)) {
            while (input.hasNextLine()) {
                String[] row = input.nextLine().split("\t", -1);
                if (row.length != 6) throw new IllegalArgumentException("Invalid fixture");
                Object[] parameters = {decode(row[2]), decode(row[3]), decode(row[4]), decode(row[5])};
                String actual = new MessageFormat(decode(row[0]), Locale.forLanguageTag("pt-PT")).format(parameters);
                if (!actual.equals(decode(row[1]))) throw new AssertionError("Formatting mismatch at fixture " + count);
                count++;
            }
        }
        if (count == 0) throw new AssertionError("No fixtures");
        System.out.println("PASS: " + count + " MessageFormat fixtures");
    }
}
