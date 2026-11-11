FROM c4g-manual-activation:26.8.0
# The old SPI is present only in this disposable regression image.
COPY --from=c4g-manual-activation-proof:26.8.0 /opt/keycloak/providers/manual-activation-proof.jar /opt/keycloak/providers/manual-activation-proof.jar
