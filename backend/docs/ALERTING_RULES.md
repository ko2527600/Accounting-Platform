# Prometheus Alerting Rules

## alerts.yml

```yaml
groups:
  - name: accounting_platform_alerts
    interval: 30s
    rules:
      # Performance Alerts
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
          description: "p95 latency is {{ $value }}s (threshold: 1s)"

      - alert: CriticalResponseTime
        expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Critical response time detected"
          description: "p99 latency is {{ $value }}s (threshold: 5s)"

      # Error Rate Alerts
      - alert: HighErrorRate
        expr: rate(http_request_errors_total[5m]) / rate(http_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"

      - alert: CriticalErrorRate
        expr: rate(http_request_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Critical error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 5%)"

      # Database Alerts
      - alert: DatabaseConnectionPoolExhaustion
        expr: db_connection_pool_used / db_connection_pool_size > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connection pool near exhaustion"
          description: "Pool usage is {{ $value | humanizePercentage }} (threshold: 80%)"

      - alert: SlowDatabaseQueries
        expr: histogram_quantile(0.95, rate(db_query_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow database queries detected"
          description: "p95 query duration is {{ $value }}s (threshold: 1s)"

      # Rate Limiting Alerts
      - alert: RateLimitExceededFrequently
        expr: rate(rate_limit_exceeded_total[5m]) > 1.67
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Rate limit exceeded frequently"
          description: "Rate limit exceeded {{ $value }} times per second (threshold: 100/min)"

      - alert: PossibleDDoSAttack
        expr: rate(rate_limit_exceeded_total[1m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Possible DDoS attack detected"
          description: "Rate limit exceeded {{ $value }} times per second"

      # Cache Alerts
      - alert: LowCacheHitRate
        expr: rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m])) < 0.7
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low cache hit rate"
          description: "Cache hit rate is {{ $value | humanizePercentage }} (threshold: 70%)"

      # System Resource Alerts
      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / node_memory_MemTotal_bytes > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value | humanizePercentage }} (threshold: 85%)"

      - alert: HighCPUUsage
        expr: rate(process_cpu_seconds_total[5m]) > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value | humanizePercentage }} (threshold: 80%)"

      # Business Metric Alerts
      - alert: NoJournalEntriesPosted
        expr: rate(journal_entries_posted_total[1h]) == 0
        for: 2h
        labels:
          severity: warning
        annotations:
          summary: "No journal entries posted in 2 hours"
          description: "System may be experiencing issues or no activity"

      - alert: ReportGenerationTooSlow
        expr: histogram_quantile(0.95, rate(report_generation_duration_seconds_bucket[5m])) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Report generation too slow"
          description: "p95 report generation time is {{ $value }}s (threshold: 30s)"
```

## Grafana Dashboard JSON

Save as `grafana-dashboard.json`:

```json
{
  "dashboard": {
    "title": "Accounting Platform Performance",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [{
          "expr": "rate(http_requests_total[1m])"
        }]
      },
      {
        "title": "Response Time (p95, p99)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "p99"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [{
          "expr": "rate(http_request_errors_total[1m]) / rate(http_requests_total[1m])"
        }]
      },
      {
        "title": "Database Connection Pool",
        "targets": [
          {
            "expr": "db_connection_pool_size",
            "legendFormat": "Pool Size"
          },
          {
            "expr": "db_connection_pool_used",
            "legendFormat": "Used Connections"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [{
          "expr": "rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))"
        }]
      }
    ]
  }
}
```

## Setup Instructions

1. **Install Prometheus**:
   ```bash
   docker run -d -p 9090:9090 -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus
   ```

2. **Configure Prometheus** (prometheus.yml):
   ```yaml
   global:
     scrape_interval: 15s
     evaluation_interval: 15s

   rule_files:
     - 'alerts.yml'

   scrape_configs:
     - job_name: 'accounting-backend'
       static_configs:
         - targets: ['localhost:4000']
       metrics_path: '/metrics'
   ```

3. **Install Grafana**:
   ```bash
   docker run -d -p 3000:3000 grafana/grafana
   ```

4. **Add Prometheus as Data Source** in Grafana:
   - URL: http://prometheus:9090
   - Import dashboard JSON

## Alert Notification Channels

### Slack Integration

```yaml
receivers:
  - name: 'slack-notifications'
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ .Annotations.description }}'
```

### PagerDuty Integration

```yaml
receivers:
  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_SERVICE_KEY'
        severity: '{{ .Labels.severity }}'
```

### Email Integration

```yaml
receivers:
  - name: 'email'
    email_configs:
      - to: 'ops-team@company.com'
        from: 'alerts@company.com'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'alerts@company.com'
        auth_password: 'PASSWORD'
```
