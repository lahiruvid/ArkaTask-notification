# clean-event-service: multi-stage build, runs on linux/arm64 (Oracle Ampere A1) and linux/amd64.
# Build stage caches ~/.m2 between builds. Runtime is the JRE only, as a non-root user.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -DskipTests package \
 && cp target/clean-event-service-*.jar /tmp/app.jar \
 && java -Djarmode=tools -jar /tmp/app.jar extract --destination /out

FROM eclipse-temurin:17-jre-noble
# uid 10001 owns /var/lib/arkatasks so the shared Supabase keys volume starts writable.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --no-create-home app \
 && install -d -o app -g app -m 700 /var/lib/arkatasks
WORKDIR /app
COPY --from=build /out/lib ./lib
COPY --from=build /out/app.jar ./app.jar
USER app
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
