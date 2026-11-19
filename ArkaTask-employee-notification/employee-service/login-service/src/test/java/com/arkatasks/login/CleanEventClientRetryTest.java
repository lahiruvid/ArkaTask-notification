package com.arkatasks.login;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.context.annotation.Import;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

@SpringBootTest(
    classes = CleanEventClientRetryTest.Slice.class,
    properties = {
      "app.clean-event-url=http://clean-event-service:8082",
      "resilience4j.retry.instances.interService.max-attempts=3",
      "resilience4j.retry.instances.interService.wait-duration=1ms",
      "resilience4j.retry.instances.interService.enable-exponential-backoff=true",
      "resilience4j.retry.instances.interService.exponential-backoff-multiplier=2",
      "resilience4j.retry.instances.interService.retry-exceptions=org.springframework.web.client.RestClientException",
      "eureka.client.enabled=false",
      "spring.cloud.discovery.enabled=false"
    })
class CleanEventClientRetryTest {
  @Configuration
  @EnableAspectJAutoProxy(proxyTargetClass = true)
  @EnableAutoConfiguration(exclude = {
      DataSourceAutoConfiguration.class,
      DataSourceTransactionManagerAutoConfiguration.class
  })
  @Import(io.github.resilience4j.springboot3.retry.autoconfigure.RetryAutoConfiguration.class)
  @ComponentScan(
      basePackageClasses = CleanEventClient.class,
      useDefaultFilters = false,
      includeFilters = @ComponentScan.Filter(
          type = FilterType.ASSIGNABLE_TYPE,
          classes = CleanEventClient.class))
  static class Slice {}

  @Autowired
  CleanEventClient client;

  @MockBean
  RestTemplate restTemplate;

  @Test
  void firstCallFailsSecondSucceeds() {
    when(restTemplate.postForEntity(anyString(), any(), eq(Void.class)))
        .thenThrow(new RestClientException("down"))
        .thenReturn(ResponseEntity.noContent().build());

    client.employeeOpened("e-maria", "Maria Rossi");

    verify(restTemplate, times(2)).postForEntity(anyString(), any(), eq(Void.class));
  }
}
