FROM quay.io/keycloak/keycloak:26.8.0 AS keycloak
FROM eclipse-temurin:21-jdk AS build
WORKDIR /build
COPY --from=keycloak /opt/keycloak/lib/lib/main /build/libraries
COPY dev/keycloak/email-templates/src/main /build/source
RUN mkdir classes && find source/java -name '*.java' -print > sources.txt \
    && javac --release 21 -encoding UTF-8 -classpath 'libraries/*' -d classes @sources.txt \
    && cp -R source/resources/. classes/ \
    && jar --create --file /build/c4g-email-templates.jar -C classes .
FROM scratch
COPY --from=build /build/c4g-email-templates.jar /c4g-email-templates.jar
