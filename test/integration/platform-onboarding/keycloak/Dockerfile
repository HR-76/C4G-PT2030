FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /proof
COPY pom.xml .
COPY src src
RUN mvn -q -DskipTests package
FROM quay.io/keycloak/keycloak:26.8.0
COPY --from=build /proof/target/manual-activation-proof-1.0.jar /opt/keycloak/providers/manual-activation-proof.jar
# Disposable proof only. Never installed in the usual realm.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start-dev"]
