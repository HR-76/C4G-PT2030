FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /proof
COPY pom.xml .
COPY src src
RUN mvn -q -DskipTests package
FROM quay.io/keycloak/keycloak:26.8.0
COPY --from=build /proof/target/c4g-manual-activation-1.0.jar /opt/keycloak/providers/c4g-manual-activation.jar
# Explicit realm/client allowlist and private bridge configuration required.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start-dev"]
