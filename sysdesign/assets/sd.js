// System design toolkit: service catalog, animated architecture diagrams, and the case-study page renderer.
// Depends on jQuery and core.js (DSA.player and helpers).
var SD = (function ($) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var AZ = 'https://learn.microsoft.com/en-us/azure/', AWS = 'https://aws.amazon.com/';

  // ---------------------------------------------------------------- page index (navigation + hub)
  var FUND = [
    ['basics', 'Fundamentals: requirements, latency, availability, CAP'],
    ['estimation', 'Estimating compute and choosing a database'],
    ['scaling', 'Scaling, load balancing and the edge'],
    ['data', 'Data: databases, replication, sharding'],
    ['caching', 'Caching'],
    ['messaging', 'Messaging and event-driven design'],
    ['reliability', 'Reliability and resilience'],
    ['architecture', 'Architecture styles and API design'],
    ['security-ops', 'Security, observability and cost'],
    ['ai-foundations', 'AI systems fundamentals'],
    ['ai-evaluation', 'Evaluating RAG, LLM and AI systems'],
    ['interview', 'The system design interview']
  ];
  var CASES = [
    ['scaling-web-app', 'Scale a web app from 1 to 10 million users', 'Basic', 'The classic journey: one server, then load balancers, caches, replicas, CDN, queues and multiple regions.'],
    ['url-shortener', 'URL shortener and Pastebin', 'Basic', 'Short codes, base62, read-heavy caching, redirects at the edge, expiry and analytics.'],
    ['rate-limiter', 'Distributed rate limiter', 'Basic', 'Token bucket and sliding windows shared across servers with Redis, at the gateway.'],
    ['unique-id', 'Unique ID generator', 'Basic', 'Snowflake IDs, UUIDv7, ticket servers and ordering without a central bottleneck.'],
    ['notification', 'Notification system', 'Basic', 'Push, SMS and email fan-out with templates, preferences, retries and deduplication.'],
    ['web-crawler', 'Web crawler', 'Basic', 'URL frontier, politeness, deduplication with Bloom filters, and distributed fetchers.'],
    ['typeahead', 'Search autocomplete (typeahead)', 'Basic', 'Prefix tries with top-k caching, offline aggregation and edge caching for millisecond suggestions.'],
    ['leaderboard', 'Real-time leaderboard', 'Basic', 'Redis sorted sets, sharded rankings and friends leaderboards.'],
    ['news-feed', 'News feed and social timeline', 'Intermediate', 'Fan-out on write vs read, the celebrity problem, ranking and media.'],
    ['chat', 'Chat and messaging', 'Intermediate', 'WebSocket gateways, message ordering, delivery receipts, offline sync and group chat.'],
    ['file-storage', 'File storage and sync', 'Intermediate', 'Chunking, deduplication, metadata vs blobs, sync conflicts and sharing.'],
    ['video-streaming', 'Video streaming platform', 'Intermediate', 'Upload, transcoding pipeline, adaptive bitrate (HLS/DASH), CDN delivery and recommendations.'],
    ['ride-hailing', 'Ride hailing', 'Intermediate', 'Location ingestion, geo-indexing, matching drivers, trip state machine and surge pricing.'],
    ['proximity', 'Nearby places search', 'Intermediate', 'Geohash, quadtrees and S2/H3 cells for "restaurants near me".'],
    ['ecommerce', 'E-commerce marketplace', 'Intermediate', 'Catalog, search, cart, checkout, inventory reservation, orders and payments with sagas.'],
    ['ticket-booking', 'Ticket booking', 'Intermediate', 'Seat holds, high-contention flash sales, virtual waiting rooms and no double booking.'],
    ['hotel-booking', 'Hotel and home booking', 'Intermediate', 'Search by place and dates, availability calendars, reservations and pricing.'],
    ['email', 'Email service', 'Intermediate', 'SMTP ingest, spam filtering, mailbox storage, search and attachments.'],
    ['payment', 'Payment system and digital wallet', 'Intermediate', 'Idempotency, double-entry ledger, PSP integration, reconciliation and exactly-once money movement.'],
    ['search-engine', 'Web search engine', 'Intermediate', 'Crawling, inverted indexes, ranking, sharded query serving and freshness.'],
    ['kv-store', 'Distributed key-value store', 'Advanced', 'Consistent hashing, replication, quorums, vector clocks, gossip and anti-entropy (Dynamo-style).'],
    ['distributed-cache', 'Distributed cache', 'Advanced', 'Sharding, eviction, replication, hot keys and cache stampedes at cluster scale.'],
    ['message-queue', 'Distributed message queue / event log', 'Advanced', 'Partitions, replication (ISR), consumer groups, offsets and exactly-once semantics.'],
    ['observability', 'Metrics, logging and tracing platform', 'Advanced', 'High-cardinality time series, log pipelines, trace sampling, alerting and retention tiers.'],
    ['job-scheduler', 'Distributed job scheduler', 'Advanced', 'Cron at scale, leases, exactly-once execution, retries and priorities.'],
    ['ad-click', 'Ad click aggregation', 'Advanced', 'Real-time stream aggregation, windows, late events, dedup and reconciliation.'],
    ['stock-exchange', 'Stock exchange and trading engine', 'Advanced', 'Order books, a single-threaded matching engine, sequencers and microsecond latency.'],
    ['collab-editor', 'Collaborative editor', 'Advanced', 'Operational transform vs CRDTs, presence, document sessions and history.'],
    ['video-conferencing', 'Video conferencing', 'Advanced', 'WebRTC, SFUs, simulcast, TURN relays and global media routing.'],
    ['live-streaming', 'Live streaming', 'Advanced', 'RTMP/SRT ingest, real-time transcoding, low-latency HLS, chat at scale.'],
    ['maps', 'Maps and navigation', 'Advanced', 'Map tiles, routing graphs with contraction hierarchies, live traffic and ETAs.'],
    ['multiplayer-game', 'Multiplayer game backend', 'Advanced', 'Matchmaking, authoritative game servers, tick rates, lag compensation and fleets.'],
    ['iot-platform', 'IoT telemetry platform', 'Advanced', 'Device identity, MQTT ingestion, digital twins, hot/warm/cold paths and commands.'],
    ['saas-platform', 'Multi-tenant SaaS platform', 'Advanced', 'Tenant isolation models, deployment stamps, noisy neighbours, billing and onboarding.'],
    ['rag-assistant', 'RAG knowledge assistant', 'AI', 'Ingestion, chunking, embeddings, hybrid retrieval, reranking, grounded generation and citations.'],
    ['agentic-ai', 'AI agent with tools', 'AI', 'Plan-act-observe loops, tool calling, memory, sandboxing, human approval and limits.'],
    ['multi-agent', 'Multi-agent system', 'AI', 'Orchestrator and specialist agents, handoffs, shared state, MCP/A2A protocols and evaluation.'],
    ['llm-gateway', 'LLM / AI gateway', 'AI', 'One front door for many models: auth, quotas, routing, failover, semantic caching and cost tracking.'],
    ['llm-serving', 'LLM inference platform', 'AI', 'GPU serving with continuous batching, KV cache, quantisation, autoscaling and token-level SLOs.'],
    ['coding-assistant', 'AI coding assistant', 'AI', 'IDE completions in under 300 ms, repository context retrieval, chat and agentic code changes.'],
    ['semantic-search', 'Semantic and enterprise search', 'AI', 'Embeddings, vector indexes, hybrid BM25 + vector, permissions-aware results.'],
    ['document-ai', 'Intelligent document processing', 'AI', 'OCR, layout and field extraction, LLM validation, human review and straight-through processing.'],
    ['voice-assistant', 'Real-time voice AI assistant', 'AI', 'Streaming speech-to-text, LLM, text-to-speech, barge-in and sub-second turn latency.'],
    ['recommendation', 'Recommendation system', 'AI', 'Candidate generation, ranking, feature stores, real-time signals and A/B testing.'],
    ['ml-platform', 'ML platform and MLOps', 'AI', 'Feature store, training pipelines, model registry, deployment, monitoring and retraining.'],
    ['training-cluster', 'Distributed LLM training cluster', 'AI', 'Thousands of GPUs: data/tensor/pipeline parallelism, checkpoints, failures and data pipelines.'],
    ['llmops', 'LLM evaluation, guardrails and observability', 'AI', 'Offline and online evals, prompt versioning, tracing, safety filters and feedback loops.'],
    ['image-generation', 'AI image generation service', 'AI', 'Queue-based GPU workers for diffusion models, safety checks, storage and delivery.'],
    ['content-moderation', 'AI content moderation', 'AI', 'Multi-stage classifiers, LLM policy reasoning, human review queues and appeals.']
  ];
  var ALL = FUND.map(function (f) { return [f[0], f[1], 'Fundamentals']; }).concat(CASES);

  // ---------------------------------------------------------------- service catalog (links verified Oct 2026)
  function az(n, p) { return [n, AZ + p]; }
  function aw(n, p) { return [n, AWS + p]; }
  var CAT = {
    dns:        ['DNS', [az('Azure DNS', 'dns/')], [aw('Amazon Route 53', 'route53/')]],
    cdn:        ['CDN / edge', [az('Azure Front Door', 'frontdoor/')], [aw('Amazon CloudFront', 'cloudfront/')]],
    waf:        ['Web application firewall', [az('Azure WAF', 'web-application-firewall/')], [aw('AWS WAF', 'waf/')]],
    ddos:       ['DDoS protection', [az('Azure DDoS Protection', 'ddos-protection/')], [aw('AWS Shield', 'shield/')]],
    globallb:   ['Global load balancing', [az('Azure Front Door', 'frontdoor/'), az('Traffic Manager', 'traffic-manager/')], [aw('Route 53', 'route53/'), aw('Global Accelerator', 'global-accelerator/')]],
    lb:         ['Regional load balancer', [az('Application Gateway', 'application-gateway/'), az('Azure Load Balancer', 'load-balancer/')], [aw('Elastic Load Balancing (ALB / NLB)', 'elasticloadbalancing/')]],
    apigw:      ['API gateway', [az('Azure API Management', 'api-management/')], [aw('Amazon API Gateway', 'api-gateway/')]],
    k8s:        ['Kubernetes', [az('Azure Kubernetes Service (AKS)', 'aks/')], [aw('Amazon EKS', 'eks/')]],
    containers: ['Serverless containers', [az('Azure Container Apps', 'container-apps/')], [aw('Amazon ECS', 'ecs/'), aw('AWS Fargate', 'fargate/')]],
    webapp:     ['Managed web hosting', [az('Azure App Service', 'app-service/')], [aw('AWS Elastic Beanstalk', 'elasticbeanstalk/'), aw('Amazon ECS', 'ecs/')]],
    functions:  ['Serverless functions', [az('Azure Functions', 'azure-functions/')], [aw('AWS Lambda', 'lambda/')]],
    vms:        ['VMs with autoscaling', [az('Virtual Machine Scale Sets', 'virtual-machine-scale-sets/')], [aw('Amazon EC2 Auto Scaling', 'ec2/autoscaling/')]],
    sql:        ['Relational database', [az('Azure SQL Database', 'azure-sql/'), az('Azure Database for PostgreSQL', 'postgresql/')], [aw('Amazon Aurora', 'rds/aurora/'), aw('Amazon RDS', 'rds/')]],
    distsql:    ['Distributed SQL', [az('Azure Cosmos DB for PostgreSQL', 'cosmos-db/'), az('Azure SQL Hyperscale', 'azure-sql/')], [aw('Amazon Aurora DSQL', 'rds/aurora/dsql/')]],
    nosql:      ['NoSQL document / key-value', [az('Azure Cosmos DB', 'cosmos-db/')], [aw('Amazon DynamoDB', 'dynamodb/')]],
    widecol:    ['Wide-column (Cassandra)', [az('Managed Instance for Apache Cassandra', 'managed-instance-apache-cassandra/')], [aw('Amazon Keyspaces', 'keyspaces/')]],
    cache:      ['In-memory cache', [az('Azure Managed Redis', 'redis/')], [aw('Amazon ElastiCache', 'elasticache/'), aw('Amazon MemoryDB', 'memorydb/')]],
    blob:       ['Object storage', [az('Azure Blob Storage', 'storage/blobs/')], [aw('Amazon S3', 's3/')]],
    search:     ['Search engine', [az('Azure AI Search', 'search/')], [aw('Amazon OpenSearch Service', 'opensearch-service/')]],
    queue:      ['Message queue', [az('Azure Service Bus', 'service-bus-messaging/')], [aw('Amazon SQS', 'sqs/')]],
    pubsub:     ['Pub/sub and events', [az('Azure Event Grid', 'event-grid/'), az('Service Bus topics', 'service-bus-messaging/')], [aw('Amazon SNS', 'sns/'), aw('Amazon EventBridge', 'eventbridge/')]],
    stream:     ['Event streaming', [az('Azure Event Hubs (Kafka API)', 'event-hubs/')], [aw('Amazon Kinesis Data Streams', 'kinesis/data-streams/'), aw('Amazon MSK (Kafka)', 'msk/')]],
    streamproc: ['Stream processing', [az('Azure Stream Analytics', 'stream-analytics/'), az('Azure Databricks', 'databricks/')], [aw('Managed Service for Apache Flink', 'managed-service-apache-flink/')]],
    workflow:   ['Workflow orchestration', [az('Durable Functions', 'azure-functions/'), az('Logic Apps', 'logic-apps/')], [aw('AWS Step Functions', 'step-functions/')]],
    scheduler:  ['Scheduled jobs', [az('Azure Functions timers', 'azure-functions/'), az('Logic Apps', 'logic-apps/')], [aw('EventBridge Scheduler', 'eventbridge/scheduler/')]],
    realtime:   ['Real-time messaging (WebSocket)', [az('Azure Web PubSub', 'azure-web-pubsub/'), az('Azure SignalR Service', 'azure-signalr/')], [aw('API Gateway WebSockets', 'api-gateway/'), aw('AWS AppSync', 'appsync/')]],
    push:       ['Mobile push / SMS', [az('Notification Hubs', 'notification-hubs/'), az('Azure Communication Services', 'communication-services/')], [aw('Amazon SNS', 'sns/'), aw('AWS End User Messaging', 'end-user-messaging/')]],
    email:      ['Email sending', [az('Azure Communication Services Email', 'communication-services/')], [aw('Amazon SES', 'ses/')]],
    identity:   ['Customer identity', [['Microsoft Entra External ID', 'https://learn.microsoft.com/en-us/entra/external-id/']], [aw('Amazon Cognito', 'cognito/')]],
    workforce:  ['Workforce identity', [['Microsoft Entra ID', 'https://learn.microsoft.com/en-us/entra/identity/']], [aw('AWS IAM Identity Center', 'iam/identity-center/')]],
    secrets:    ['Secrets and keys', [az('Azure Key Vault', 'key-vault/')], [aw('AWS Secrets Manager', 'secrets-manager/'), aw('AWS KMS', 'kms/')]],
    monitor:    ['Monitoring and tracing', [az('Azure Monitor + Application Insights', 'azure-monitor/')], [aw('Amazon CloudWatch', 'cloudwatch/'), aw('CloudWatch Application Signals / X-Ray', 'xray/')]],
    logs:       ['Log and telemetry analytics', [az('Azure Data Explorer', 'data-explorer/'), az('Log Analytics (Azure Monitor)', 'azure-monitor/')], [aw('Amazon OpenSearch Service', 'opensearch-service/'), aw('CloudWatch Logs', 'cloudwatch/')]],
    timeseries: ['Time-series database', [az('Azure Data Explorer', 'data-explorer/')], [aw('Amazon Timestream', 'timestream/')]],
    warehouse:  ['Analytics / data warehouse', [['Microsoft Fabric', 'https://learn.microsoft.com/en-us/fabric/'], az('Azure Databricks', 'databricks/')], [aw('Amazon Redshift', 'redshift/'), aw('Amazon Athena', 'athena/')]],
    etl:        ['Data integration / ETL', [az('Azure Data Factory', 'data-factory/')], [aw('AWS Glue', 'glue/')]],
    bigdata:    ['Big data processing (Spark)', [az('Azure Databricks', 'databricks/')], [aw('Amazon EMR', 'emr/')]],
    graph:      ['Graph database', [az('Cosmos DB for Apache Gremlin', 'cosmos-db/gremlin/')], [aw('Amazon Neptune', 'neptune/')]],
    maps:       ['Maps and geospatial', [az('Azure Maps', 'azure-maps/')], [aw('Amazon Location Service', 'location/')]],
    transcode:  ['Video transcoding', [az('Azure Batch / AKS with FFmpeg', 'batch/')], [aw('AWS Elemental MediaConvert', 'mediaconvert/')]],
    livevideo:  ['Live video', [az('Azure Communication Services', 'communication-services/')], [aw('Amazon IVS', 'ivs/'), aw('AWS Elemental MediaLive', 'medialive/')]],
    rtc:        ['Real-time audio/video (WebRTC)', [az('Azure Communication Services calling', 'communication-services/')], [aw('Amazon Chime SDK', 'chime/chime-sdk/')]],
    iot:        ['IoT device hub', [az('Azure IoT Hub', 'iot-hub/')], [aw('AWS IoT Core', 'iot-core/')]],
    games:      ['Game services', [['Azure PlayFab', 'https://learn.microsoft.com/en-us/xbox/playfab/']], [aw('Amazon GameLift', 'gamelift/')]],
    batch:      ['Batch compute', [az('Azure Batch', 'batch/')], [aw('AWS Batch', 'batch/')]],
    llm:        ['Foundation models (LLM API)', [['Azure OpenAI in Microsoft Foundry', AZ + 'foundry/foundry-models/concepts/models-sold-directly-by-azure']], [aw('Amazon Bedrock', 'bedrock/')]],
    aiplatform: ['AI application platform', [az('Microsoft Foundry', 'foundry/')], [aw('Amazon Bedrock', 'bedrock/'), aw('Amazon SageMaker AI', 'sagemaker/ai/')]],
    ml:         ['ML training and serving', [az('Azure Machine Learning', 'machine-learning/')], [aw('Amazon SageMaker AI', 'sagemaker/ai/')]],
    featurestore: ['Feature store', [az('Azure ML managed feature store', 'machine-learning/concept-what-is-managed-feature-store')], [aw('SageMaker Feature Store', 'sagemaker/ai/feature-store/')]],
    mlpipeline: ['ML pipelines', [az('Azure Machine Learning pipelines', 'machine-learning/')], [aw('SageMaker Pipelines', 'sagemaker/ai/pipelines/')]],
    gpu:        ['GPU compute', [az('GPU VM sizes', 'virtual-machines/sizes/overview'), az('AKS GPU node pools', 'aks/use-nvidia-gpu')], [aw('EC2 P5 instances', 'ec2/instance-types/p5/'), aw('SageMaker HyperPod', 'sagemaker/ai/hyperpod/')]],
    vector:     ['Vector search', [az('Azure AI Search vector search', 'search/vector-search-overview'), az('Cosmos DB vector search', 'cosmos-db/vector-search')], [aw('OpenSearch vector engine', 'opensearch-service/serverless-vector-database/'), aw('Amazon S3 Vectors', 's3/features/vectors/')]],
    ragkb:      ['Managed RAG / retrieval', [az('Azure AI Search agentic retrieval', 'search/agentic-retrieval-overview')], [aw('Bedrock Knowledge Bases', 'bedrock/knowledge-bases/'), aw('Amazon Kendra', 'kendra/')]],
    agents:     ['Agent runtime', [az('Foundry Agent Service', 'foundry/agents/overview')], [aw('Amazon Bedrock AgentCore', 'bedrock/agentcore/'), aw('Bedrock Agents', 'bedrock/agents/')]],
    guardrails: ['AI safety filters', [az('Azure AI Content Safety', 'ai-services/content-safety/')], [aw('Amazon Bedrock Guardrails', 'bedrock/guardrails/')]],
    aieval:     ['AI evaluation and tracing', [az('Foundry evaluations', 'foundry/how-to/evaluate-generative-ai-app'), az('Foundry observability', 'foundry/concepts/observability')], [aw('Amazon Bedrock Evaluations', 'bedrock/evaluations/'), aw('Amazon CloudWatch', 'cloudwatch/')]],
    aigw:       ['AI gateway', [az('API Management AI gateway', 'api-management/genai-gateway-capabilities')], [aw('Amazon API Gateway', 'api-gateway/'), aw('Amazon Bedrock', 'bedrock/')]],
    semcache:   ['Semantic cache', [az('Cosmos DB semantic cache', 'cosmos-db/gen-ai/semantic-cache'), az('Azure Managed Redis', 'redis/')], [aw('Amazon ElastiCache (vector search)', 'elasticache/'), aw('Amazon MemoryDB', 'memorydb/')]],
    docai:      ['Document AI (OCR + extraction)', [az('Azure AI Document Intelligence', 'ai-services/document-intelligence/')], [aw('Amazon Textract', 'textract/')]],
    speech:     ['Speech to text / text to speech', [az('Azure AI Speech', 'ai-services/speech-service/')], [aw('Amazon Transcribe', 'transcribe/'), aw('Amazon Polly', 'polly/')]],
    vision:     ['Image and video moderation', [az('Azure AI Content Safety', 'ai-services/content-safety/')], [aw('Amazon Rekognition', 'rekognition/')]],
    recsvc:     ['Managed recommendations', [az('Azure Machine Learning', 'machine-learning/')], [aw('Amazon Personalize', 'personalize/')]],
    ledger:     ['Tamper-evident ledger', [az('Azure Confidential Ledger', 'confidential-ledger/')], [aw('Amazon Aurora (append-only ledger tables)', 'rds/aurora/')]],
    registry:   ['Container registry', [az('Azure Container Registry', 'container-registry/')], [aw('Amazon ECR', 'ecr/')]],
    network:    ['Private networking', [az('Virtual Network', 'virtual-network/'), az('Private Link', 'private-link/')], [aw('Amazon VPC', 'vpc/'), aw('AWS PrivateLink', 'privatelink/')]]
  };

  // ---------------------------------------------------------------- reference architectures (verified)
  var L = 'https://learn.microsoft.com/en-us/azure/architecture/', P = L + 'patterns/';
  var AP = 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/', WA = 'https://docs.aws.amazon.com/wellarchitected/latest/';
  var REF = {
    azArch: ['Azure Architecture Center', L], azWaf: ['Azure Well-Architected Framework', 'https://learn.microsoft.com/en-us/azure/well-architected/'],
    azPatterns: ['Azure cloud design patterns', P], azBaselineWeb: ['Baseline zone-redundant web application', L + 'web-apps/app-service/architectures/baseline-zone-redundant'],
    azAksMicro: ['Microservices architecture on AKS', L + 'reference-architectures/containers/aks-microservices/aks-microservices'],
    azAksBaseline: ['AKS baseline cluster', L + 'reference-architectures/containers/aks/baseline-aks'],
    azMission: ['Mission-critical workloads', 'https://learn.microsoft.com/en-us/azure/well-architected/mission-critical/mission-critical-overview'],
    azMultitenant: ['Architecting multitenant solutions', L + 'guide/multitenant/overview'],
    azStyles: ['Architecture styles', L + 'guide/architecture-styles/'], azMicro: ['Microservices architecture style', L + 'guide/architecture-styles/microservices'],
    azEventDriven: ['Event-driven architecture style', L + 'guide/architecture-styles/event-driven'], azWebQueue: ['Web-Queue-Worker style', L + 'guide/architecture-styles/web-queue-worker'],
    azBigData: ['Big data architecture style', L + 'guide/architecture-styles/big-data'], azBigCompute: ['Big compute architecture style', L + 'guide/architecture-styles/big-compute'],
    azDataStore: ['Choose a data store', L + 'guide/technology-choices/data-stores-getting-started'], azCompute: ['Choose a compute service', L + 'guide/technology-choices/compute-decision-tree'],
    azMessaging: ['Choose a messaging service', L + 'guide/technology-choices/messaging'], azLbChoice: ['Choose a load-balancing service', L + 'guide/technology-choices/load-balancing-overview'],
    azCaching: ['Caching guidance', L + 'best-practices/caching'], azApi: ['RESTful web API design', L + 'best-practices/api-design'], azCdn: ['CDN guidance', L + 'best-practices/cdn'],
    azAutoscale: ['Autoscaling guidance', L + 'best-practices/auto-scaling'], azTransient: ['Transient fault handling', L + 'best-practices/transient-faults'],
    azPartition: ['Data partitioning guidance', 'https://learn.microsoft.com/en-us/azure/well-architected/design-guides/partition-data'],
    azBackground: ['Background jobs', L + 'best-practices/background-jobs'], azMonitoring: ['Monitoring and diagnostics guidance', L + 'best-practices/monitoring'],
    azOutbox: ['Transactional outbox with Cosmos DB', L + 'databases/guide/transactional-out-box-cosmos'],
    azStreamAsa: ['Stream processing with Stream Analytics', L + 'reference-architectures/data/stream-processing-stream-analytics'],
    azStreamDbx: ['Stream processing with Databricks', L + 'reference-architectures/data/stream-processing-databricks'],
    azFoundryChat: ['Baseline Microsoft Foundry chat reference architecture', L + 'ai-ml/architecture/baseline-microsoft-foundry-chat'],
    azRag: ['Design and develop a RAG solution', L + 'ai-ml/guide/rag/rag-solution-design-and-evaluation-guide'], azRagChunk: ['RAG chunking phase', L + 'ai-ml/guide/rag/rag-chunking-phase'],
    azRagMt: ['Secure multitenant RAG', L + 'ai-ml/guide/secure-multitenant-rag'], azAgents: ['AI agent orchestration patterns', L + 'ai-ml/guide/ai-agent-design-patterns'],
    azGenGw: ['Generative AI gateway guide', L + 'ai-ml/guide/generative-ai-gateway'], azGenGwMulti: ['Gateway in front of multiple models', L + 'ai-ml/guide/generative-ai-gateway-multiple-models'],
    azMlops: ['Machine learning operations (MLOps v2)', L + 'ai-ml/guide/machine-learning-operations-v2'], azGenAiOps: ['GenAIOps for MLOps practitioners', L + 'ai-ml/guide/genaiops-for-mlops'],
    azDocProc: ['Multimodal content processing', L + 'ai-ml/idea/multi-modal-content-processing'], azPtu: ['Provisioned throughput for Azure OpenAI', AZ + 'foundry/openai/concepts/provisioned-throughput'],
    azApimAi: ['API Management AI gateway capabilities', AZ + 'api-management/genai-gateway-capabilities'], azGaming: ['Azure for gaming', 'https://learn.microsoft.com/en-us/gaming/azure/'],
    azEvalHowTo: ['Evaluate generative AI apps (Foundry)', AZ + 'foundry/how-to/evaluate-generative-ai-app'], azObservability: ['Observability in generative AI (Foundry)', AZ + 'foundry/concepts/observability'],
    azEvalRag: ['RAG evaluators (Foundry)', AZ + 'foundry/concepts/evaluation-evaluators/rag-evaluators'], azEvalAgent: ['Agent evaluators (Foundry)', AZ + 'foundry/concepts/evaluation-evaluators/agent-evaluators'],
    azEvalSafety: ['Risk and safety evaluators (Foundry)', AZ + 'foundry/concepts/evaluation-evaluators/risk-safety-evaluators'], azEvalText: ['Textual similarity evaluators (Foundry)', AZ + 'foundry/concepts/evaluation-evaluators/textual-similarity-evaluators'],
    azEvalGeneral: ['General-purpose evaluators (Foundry)', AZ + 'foundry/concepts/evaluation-evaluators/general-purpose-evaluators'],
    azRagEvalPhase: ['RAG LLM evaluation phase', L + 'ai-ml/guide/rag/rag-llm-evaluation-phase'], azRagRetrieval: ['RAG information retrieval phase', L + 'ai-ml/guide/rag/rag-information-retrieval'],
    awsBedrockEval: ['Amazon Bedrock evaluations (user guide)', 'https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation.html'], awsBedrockKbEval: ['Evaluate RAG with Bedrock Knowledge Bases', 'https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation-kb.html'],
    awsBedrockJudge: ['LLM-as-a-judge model evaluation in Bedrock', 'https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation-judge.html'], awsClarifyFm: ['SageMaker Clarify foundation model evaluation', 'https://docs.aws.amazon.com/sagemaker/latest/dg/clarify-foundation-model-evaluate.html'],
    awsArch: ['AWS Architecture Center', 'https://aws.amazon.com/architecture/'], awsWaf: ['AWS Well-Architected Framework', WA + 'framework/welcome.html'],
    awsDiagrams: ['AWS reference architecture diagrams', 'https://docs.aws.amazon.com/reference-architecture-diagrams/'], awsPatterns: ['AWS cloud design patterns', AP + 'introduction.html'],
    awsMicro: ['Implementing microservices on AWS', 'https://docs.aws.amazon.com/whitepapers/latest/microservices-on-aws/microservices-on-aws.html'],
    awsSaga: ['Saga patterns', AP + 'saga-patterns.html'], awsSagaOrch: ['Saga orchestration', AP + 'saga-orchestration.html'], awsSagaChor: ['Saga choreography', AP + 'saga-choreography.html'],
    awsOutbox: ['Transactional outbox pattern', AP + 'transactional-outbox.html'], awsRetry: ['Retry with backoff pattern', AP + 'retry-backoff.html'], awsCircuit: ['Circuit breaker pattern', AP + 'circuit-breaker.html'],
    awsStrangler: ['Strangler fig pattern', AP + 'strangler-fig.html'], awsPubSub: ['Publish-subscribe pattern', AP + 'publish-subscribe.html'], awsScatter: ['Scatter-gather pattern', AP + 'scatter-gather.html'],
    awsEventSourcing: ['Event sourcing pattern', AP + 'event-sourcing-pattern.html'], awsAcl: ['Anti-corruption layer pattern', AP + 'acl.html'], awsApiRouting: ['API routing patterns', AP + 'api-routing.html'], awsHexagonal: ['Hexagonal architecture', AP + 'hexagonal-architecture.html'],
    awsServerlessLens: ['Serverless Applications Lens', WA + 'serverless-applications-lens/welcome.html'], awsGamesLens: ['Games Industry Lens', WA + 'games-industry-lens/games-industry-lens.html'],
    awsIotLens: ['IoT Lens', WA + 'iot-lens/iot-lens.html'], awsFsiLens: ['Financial Services Industry Lens', WA + 'financial-services-industry-lens/'], awsGenAiLens: ['Generative AI Lens', WA + 'generative-ai-lens/generative-ai-lens.html'],
    awsMediaLens: ['Streaming Media Lens', WA + 'streaming-media-lens/streaming-media-lens.html'], awsSaasLens: ['SaaS Lens', WA + 'saas-lens/saas-lens.html'], awsAnalyticsLens: ['Data Analytics Lens', WA + 'analytics-lens/analytics-lens.html'],
    awsMlLens: ['Machine Learning Lens', WA + 'machine-learning-lens/machine-learning-lens.html'],
    awsRagOptions: ['RAG options and architectures on AWS', 'https://docs.aws.amazon.com/prescriptive-guidance/latest/retrieval-augmented-generation-options/introduction.html'],
    awsAgentic: ['Agentic AI patterns and workflows', 'https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/introduction.html'],
    awsAgenticFound: ['Agentic AI foundations', 'https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-foundations/introduction.html'],
    awsGenAiOps: ['Generative AI lifecycle operational excellence', 'https://docs.aws.amazon.com/prescriptive-guidance/latest/gen-ai-lifecycle-operational-excellence/introduction.html'],
    awsGenAiBuilder: ['Generative AI Application Builder on AWS', 'https://docs.aws.amazon.com/solutions/generative-ai-application-builder-on-aws/'],
    awsQnaBot: ['QnABot on AWS', 'https://docs.aws.amazon.com/solutions/qnabot-on-aws/'], awsClickstream: ['Clickstream Analytics on AWS', 'https://docs.aws.amazon.com/solutions/clickstream-analytics-on-aws/'],
    awsLogging: ['Centralized Logging with OpenSearch', 'https://docs.aws.amazon.com/solutions/centralized-logging-with-opensearch/'], awsImage: ['Dynamic Image Transformation for CloudFront', 'https://docs.aws.amazon.com/solutions/dynamic-image-transformation-for-amazon-cloudfront/'],
    awsGameAnalytics: ['Game Analytics Pipeline on AWS', 'https://docs.aws.amazon.com/solutions/game-analytics-pipeline-on-aws/'], awsWafAuto: ['Security Automations for AWS WAF', 'https://docs.aws.amazon.com/solutions/security-automations-for-aws-waf/'],
    awsLoadTest: ['Distributed Load Testing on AWS', 'https://docs.aws.amazon.com/solutions/distributed-load-testing-on-aws/'],
    awsCaching: ['Database caching strategies using Redis', 'https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/welcome.html'],
    awsDdbBest: ['DynamoDB best practices', 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html'],
    blBackoff: ['Builders’ Library: Timeouts, retries and backoff with jitter', 'https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter'],
    blShuffle: ['Builders’ Library: Workload isolation using shuffle sharding', 'https://builder.aws.com/content/3F06NpJ8YeoIGP8VHTw4n81pFn8/workload-isolation-using-shuffle-sharding'],
    blShedding: ['Builders’ Library: Using load shedding to avoid overload', 'https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload'],
    blBacklog: ['Builders’ Library: Avoiding insurmountable queue backlogs', 'https://builder.aws.com/content/3EuRcgkTP1MI0c7zM8W6HL3WIqA/avoiding-insurmountable-queue-backlogs'],
    blDistributed: ['Builders’ Library: Challenges with distributed systems', 'https://builder.aws.com/content/3F08f7GPFiZMCgXD8gny6OjxR0Z/challenges-with-distributed-systems'],
    blCaching: ['Builders’ Library: Caching challenges and strategies', 'https://builder.aws.com/content/3K9TeXp6strMiJ4vhakpRD7BQWO/caching-challenges-and-strategies'],
    blLeader: ['Builders’ Library: Leader election in distributed systems', 'https://builder.aws.com/content/3Ev0vH0hfkcUizISUWYTvHibtcp/leader-election-in-distributed-systems'],
    blStatic: ['Builders’ Library: Static stability using Availability Zones', 'https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones'],
    blHealth: ['Builders’ Library: Implementing health checks', 'https://builder.aws.com/content/3Ev53O39izHCtWLzp4XU6t8PC1O/implementing-health-checks'],
    blRollback: ['Builders’ Library: Ensuring rollback safety during deployments', 'https://builder.aws.com/content/3F04j2yRAAMBuPSPs50xwXZqg01/ensuring-rollback-safety-during-deployments'],
    blConstant: ['Builders’ Library: Reliability, constant work and a good cup of coffee', 'https://builder.aws.com/content/3F05oqNtNUWxHJ5r6L6I2HrH4rI/reliability-constant-work-and-a-good-cup-of-coffee'],
    blInstrument: ['Builders’ Library: Instrumenting distributed systems', 'https://builder.aws.com/content/3EuxPBdIiiUhB5IK47p3O3fxhy7/instrumenting-distributed-systems-for-operational-visibility'],
    blFallback: ['Builders’ Library: Avoiding fallback in distributed systems', 'https://builder.aws.com/content/3EuS9Sakq7L3VLQIF3qzfMfke1Y/avoiding-fallback-in-distributed-systems'],
    blDeploy: ['Builders’ Library: Automating safe, hands-off deployments', 'https://builder.aws.com/content/3ErTKQOTKc5NIw031UePBPxTQ6I/automating-safe-hands-off-deployments']
  };
  ['cache-aside', 'circuit-breaker', 'saga', 'cqrs', 'event-sourcing', 'sharding', 'rate-limiting-pattern', 'retry', 'bulkhead', 'competing-consumers', 'publisher-subscriber', 'queue-based-load-leveling', 'valet-key',
   'strangler-fig', 'throttling', 'priority-queue', 'claim-check', 'deployment-stamp', 'materialized-view', 'index-table', 'leader-election', 'scheduler-agent-supervisor', 'static-content-hosting', 'gateway-routing',
   'gateway-offloading', 'gateway-aggregation', 'backends-for-frontends', 'health-endpoint-monitoring', 'compensating-transaction', 'asynchronous-request-reply', 'sidecar', 'ambassador', 'anti-corruption-layer',
   'federated-identity', 'gatekeeper', 'pipes-and-filters', 'external-configuration-store', 'choreography', 'sequential-convoy'].forEach(function (p) {
    var t = p.replace(/-pattern$/, '').replace(/-/g, ' '); REF['azp-' + p] = ['Azure pattern: ' + t.charAt(0).toUpperCase() + t.slice(1), P + p];
  });

  // ---------------------------------------------------------------- small helpers
  function el(name, attrs, parent) { var e = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  function tx(parent, x, y, s, cls, anchor) { var t = el('text', { x: x, y: y, 'class': cls || '', 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central' }, parent); t.textContent = dec(s); return t; }
  function links(list) { return list.map(function (x) { return '<a href="' + x[1] + '" target="_blank" rel="noopener">' + x[0] + '</a>'; }).join(', '); }
  function svcHtml(key, side) { var c = CAT[key]; if (!c) return key; return links(side === 'az' ? c[1] : c[2]); }
  function refHtml(key) { var r = REF[key]; if (!r) return key; return '<a href="' + r[1] + '" target="_blank" rel="noopener">' + r[0] + '</a>'; }
  function esc(s) { return $('<i>').text(s).html(); }
  // text-only fields (captions, SVG labels) may contain HTML entities such as &rarr;: decode them for display
  function dec(s) { if (s == null || String(s).indexOf('&') < 0) return s; var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- architecture diagram
  var KIND = { client: 'client', user: 'client', mobile: 'client', device: 'client', dns: 'edge', cdn: 'edge', waf: 'edge', edge: 'edge', lb: 'gw', gw: 'gw', apigw: 'gw',
    svc: 'svc', worker: 'svc', fn: 'svc', job: 'svc', db: 'data', nosql: 'data', cache: 'data', blob: 'data', search: 'data', vector: 'data', tsdb: 'data', graph: 'data', dw: 'data',
    queue: 'msg', stream: 'msg', bus: 'msg', llm: 'ai', ml: 'ai', ai: 'ai', gpu: 'ai', agent: 'ai', ext: 'ext' };
  var SUB = { client: 'client', user: 'user', mobile: 'mobile app', device: 'device', dns: 'DNS', cdn: 'CDN', waf: 'WAF', edge: 'edge', lb: 'load balancer', gw: 'gateway', apigw: 'API gateway',
    svc: 'service', worker: 'worker', fn: 'function', job: 'batch job', db: 'SQL database', nosql: 'NoSQL', cache: 'cache', blob: 'object storage', search: 'search index', vector: 'vector index',
    tsdb: 'time series', graph: 'graph DB', dw: 'warehouse', queue: 'queue', stream: 'event stream', bus: 'event bus', llm: 'LLM', ml: 'model', ai: 'AI', gpu: 'GPU pool', agent: 'agent', ext: 'external' };
  var CW = 168, RH = 96, BW = 134, BH = 54, PAD = 26;
  function geom(D) {
    var pos = {}, mc = 0, mr = 0;
    D.nodes.forEach(function (n) { var x = PAD + n[3] * CW, y = PAD + n[4] * RH; pos[n[0]] = { x: x, y: y, cx: x + BW / 2, cy: y + BH / 2, n: n }; mc = Math.max(mc, n[3]); mr = Math.max(mr, n[4]); });
    return { pos: pos, w: PAD * 2 + mc * CW + BW, h: PAD * 2 + mr * RH + BH + 8 };
  }
  function clip(p, q, pad) {                                // point on p's box border towards q
    var dx = q.cx - p.cx, dy = q.cy - p.cy; if (!dx && !dy) return [p.cx, p.cy];
    var sx = dx ? (BW / 2 + pad) / Math.abs(dx) : Infinity, sy = dy ? (BH / 2 + pad) / Math.abs(dy) : Infinity, s = Math.min(sx, sy);
    return [p.cx + dx * s, p.cy + dy * s];
  }
  function drawNode(g, p, mark) {
    var n = p.n, k = KIND[n[2]] || 'svc', cls = 'box k-' + k + (mark ? ' on-' + mark : ''), x = p.x, y = p.y;
    if (k === 'data' && n[2] !== 'cache' && n[2] !== 'search') {
      el('path', { d: 'M' + x + ',' + (y + 8) + ' a' + BW / 2 + ',8 0 0,1 ' + BW + ',0 v' + (BH - 14) + ' a' + BW / 2 + ',8 0 0,1 ' + (-BW) + ',0 z', 'class': cls }, g);
      el('path', { d: 'M' + x + ',' + (y + 8) + ' a' + BW / 2 + ',8 0 0,0 ' + BW + ',0', 'class': cls, fill: 'none' }, g);
    } else {
      el('rect', { x: x, y: y, width: BW, height: BH, rx: k === 'client' ? 14 : 8, 'class': cls }, g);
      if (k === 'msg') for (var i = 0; i < 3; i++) el('line', { x1: x + BW - 26 + i * 8, y1: y + 10, x2: x + BW - 26 + i * 8, y2: y + BH - 10, 'class': 'box k-msg', 'stroke-width': 1.5 }, g);
    }
    var label = n[1], sub = n[5] || SUB[n[2]] || n[2];
    tx(g, p.cx - (k === 'msg' ? 10 : 0), p.cy - 7, label.length > 19 ? label.slice(0, 18) + '…' : label, 'nt');
    tx(g, p.cx - (k === 'msg' ? 10 : 0), p.cy + 11, sub.length > 24 ? sub.slice(0, 23) + '…' : sub, 'ns');
  }
  function arrowHead(g, x2, y2, ux, uy, cls) {
    el('polygon', { points: x2 + ',' + y2 + ' ' + (x2 - ux * 9 - uy * 4.5) + ',' + (y2 - uy * 9 + ux * 4.5) + ' ' + (x2 - ux * 9 + uy * 4.5) + ',' + (y2 - uy * 9 - ux * 4.5), 'class': cls }, g);
  }
  function diagram($stage, D, st) {
    st = st || {};
    var G = geom(D), svg = el('svg', { 'class': 'arch', viewBox: '0 0 ' + G.w + ' ' + G.h, width: G.w, height: G.h, role: 'img', 'aria-label': D.title || 'architecture diagram' });
    var gz = el('g', {}, svg), ge = el('g', {}, svg), gh = el('g', {}, svg), gn = el('g', {}, svg), gp = el('g', {}, svg);
    (D.zones || []).forEach(function (z) {
      var x1 = PAD + z[1] * CW - 12, y1 = PAD + z[2] * RH - 18, x2 = PAD + z[3] * CW + BW + 12, y2 = PAD + z[4] * RH + BH + 10;
      el('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, rx: 10, 'class': 'zone' }, gz); tx(gz, x1 + 8, y1 + 9, z[0], 'zt', 'start');
    });
    (D.edges || []).forEach(function (e) {
      var A = G.pos[e[0]], B = G.pos[e[1]]; if (!A || !B) return;
      var p1 = clip(A, B, 3), p2 = clip(B, A, 5), dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
      el('line', { x1: p1[0], y1: p1[1], x2: p2[0] - ux * 6, y2: p2[1] - uy * 6, 'class': 'ln' + (e[3] === 'async' ? ' async' : '') }, ge);
      if (e[3] !== 'none') arrowHead(ge, p2[0], p2[1], ux, uy, 'ah');
      if (e[2]) tx(ge, (p1[0] + p2[0]) / 2 - uy * 9, (p1[1] + p2[1]) / 2 + ux * 9, e[2], 'el');
    });
    (st.hops || []).forEach(function (h) {
      var A = G.pos[h.a], B = G.pos[h.b]; if (!A || !B) return;
      var p1 = clip(A, B, 3), p2 = clip(B, A, 5), dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, k = h.done ? 'done' : (h.k || 'req');
      el('line', { x1: p1[0], y1: p1[1], x2: p2[0] - ux * 6, y2: p2[1] - uy * 6, 'class': 'hop ' + k }, gh);
      arrowHead(gh, p2[0], p2[1], ux, uy, 'ah pk ' + (h.done ? '' : k));
      if (h.done) return;
      var dot = el('circle', { r: 6.5, 'class': 'pk ' + k, cx: 0, cy: 0 }, gp);
      if (reduceMotion) { dot.setAttribute('cx', p1[0] + dx * 0.6); dot.setAttribute('cy', p1[1] + dy * 0.6); }
      else el('animateMotion', { dur: '1.15s', repeatCount: 'indefinite', path: 'M' + p1[0] + ',' + p1[1] + ' L' + p2[0] + ',' + p2[1] }, dot);
      if (h.label) {
        var mx = (p1[0] + p2[0]) / 2 - uy * 14, my = (p1[1] + p2[1]) / 2 + ux * 14 - (Math.abs(uy) < 0.3 ? 4 : 0), w = Math.min(190, h.label.length * 6.1 + 14);
        el('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 9, 'class': 'pill ' + k }, gp);
        tx(gp, mx, my, h.label.length > 30 ? h.label.slice(0, 29) + '…' : h.label, 'pt');
      }
    });
    D.nodes.forEach(function (n) { drawNode(gn, G.pos[n[0]], (st.marks || {})[n[0]]); });
    $stage.append(svg);
    return svg;
  }
  function legend() {
    return '<div class="klegend">' + [['client', 'clients'], ['edge', 'edge (DNS, CDN, WAF)'], ['gw', 'gateways / load balancers'], ['svc', 'services and workers'], ['data', 'data stores'], ['msg', 'queues and streams'], ['ai', 'AI / ML'], ['ext', 'external systems']]
      .map(function (k) { return '<span><i style="border-color:var(--c-' + k[0] + ')"></i>' + k[1] + '</span>'; }).join('') +
      '<span><b style="color:var(--accent)">&#9679;</b> request</span><span><b style="color:var(--good)">&#9679;</b> response</span><span><b style="color:var(--purple)">&#9679;</b> async / event</span><span><b style="color:var(--bad)">&#9679;</b> failure</span></div>';
  }

  // flows: [{name, desc, steps: [[from, to, label, msg, kind] | {par: [[from, to, label, kind]...], msg}], end}]
  function flowFrames(f) {
    var F = [], done = [];
    F.push({ hops: [], marks: {}, msg: dec(f.desc || f.name) });
    f.steps.forEach(function (s, i) {
      var cur = s.par ? s.par.map(function (p) { return { a: p[0], b: p[1], label: p[2], k: p[3] || 'req' }; }) : [{ a: s[0], b: s[1], label: s[2], k: s[4] || 'req' }];
      var marks = {};
      cur.forEach(function (h) { marks[h.a] = h.k === 'err' ? 'c' : 'a'; marks[h.b] = h.k === 'err' ? 'c' : 'b'; });
      F.push({ hops: done.concat(cur), marks: marks, msg: (i + 1) + '. ' + dec(s.par ? s.msg : s[3]) });
      done = done.concat(cur.map(function (h) { return { a: h.a, b: h.b, done: true }; }));
    });
    F.push({ hops: done, marks: {}, msg: dec(f.end) || 'End of this flow. Pick another flow above, or press Reset to replay.' });
    return F;
  }
  function flows(root, D, list) {
    var $r = $(root), $tabs = $r.find('.flowtabs'), $desc = $r.find('.flowdesc'), cur = 0;
    function render(f, ctx) { diagram(ctx.stage, D, f); }
    var p = DSA.player(root, flowFrames(list[0]), render, { speed: 1500 });
    $r.find('.pctl select').val('1500');
    list.forEach(function (f, i) {
      $('<button type="button">').text(f.name).toggleClass('active', i === 0).on('click', function () {
        cur = i; $tabs.children().removeClass('active'); $(this).addClass('active'); $desc.text(dec(f.desc) || ''); p.set(flowFrames(f));
      }).appendTo($tabs);
    });
    $desc.text(dec(list[0].desc) || '');
    return p;
  }

  // several diagrams, each with its own flow: items = [{name, desc, diagram, steps, end}]
  function multi(root, items) {
    var $r = $(root), $tabs = $r.find('.flowtabs'), $desc = $r.find('.flowdesc'), D = items[0].diagram;
    function render(f, ctx) { diagram(ctx.stage, D, f); }
    var p = DSA.player(root, flowFrames(items[0]), render, { speed: 1500 });
    $r.find('.pctl select').val('1500');
    items.forEach(function (it, i) {
      $('<button type="button">').text(it.name).toggleClass('active', i === 0).on('click', function () {
        $tabs.children().removeClass('active'); $(this).addClass('active'); $desc.text(dec(it.desc) || ''); D = it.diagram; p.set(flowFrames(it));
      }).appendTo($tabs);
    });
    $desc.text(dec(items[0].desc) || '');
    return p;
  }

  // ---------------------------------------------------------------- page chrome helpers
  function navFor(slug, prefix) {
    var i = ALL.map(function (x) { return x[0]; }).indexOf(slug), prev = ALL[i - 1], next = ALL[i + 1];
    return { prev: prev ? [prefix + prev[0] + '/index.html', prev[1]] : [prefix + 'index.html', 'System design home'], next: next ? [prefix + next[0] + '/index.html', next[1]] : [prefix + 'index.html', 'System design home'] };
  }
  function lvlClass(l) { return l.toLowerCase(); }

  // ---------------------------------------------------------------- case-study renderer
  function table(head, rows, cellFn) {
    var h = '<div class="table-wrap"><table><tr>' + head.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr>';
    rows.forEach(function (r) { h += '<tr>' + r.map(function (c, i) { return '<td>' + (cellFn ? cellFn(c, i) : c) + '</td>'; }).join('') + '</tr>'; });
    return h + '</table></div>';
  }
  function renderCase(C) {
    var meta = CASES.filter(function (c) { return c[0] === C.slug; })[0] || [C.slug, C.title, C.level, ''];
    var nav = navFor(C.slug, '../'), $root = $('#case'), h = '';
    document.title = meta[1] + ' - System Design';
    $('header.top h1').text(meta[1]);
    $('header.top nav').html('<a href="../index.html">System design home</a><a href="' + nav.prev[0] + '">&larr; Previous</a><a href="' + nav.next[0] + '">Next &rarr;</a>');

    h += '<h2 id="overview" style="border-top:0;margin-top:1rem">Overview <span class="lvl ' + lvlClass(meta[2]) + '">' + meta[2] + '</span></h2>';
    h += '<p>' + C.summary + '</p>';
    if (C.examples) h += '<p class="muted"><strong>Real-world examples:</strong> ' + C.examples + '</p>';
    h += '<nav id="toc" class="card" aria-label="On this page"></nav>';

    h += '<h2 id="requirements">1. Requirements</h2><div class="req-cols">';
    [['Functional', C.functional], ['Non-functional', C.nonFunctional], ['Out of scope', C.outOfScope]].forEach(function (b) {
      if (b[1] && b[1].length) h += '<div class="card"><h3>' + b[0] + '</h3><ul>' + b[1].map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>';
    });
    h += '</div>';

    h += '<h2 id="estimation">2. Capacity estimation</h2>';
    if (C.estimates) h += table(['Quantity', 'Estimate', 'How we got it'], C.estimates);
    if (C.compute) { h += '<h3>Compute estimate</h3>' + table(['Component', 'Sizing', 'Reasoning'], C.compute); }
    h += '<p class="muted">Order-of-magnitude numbers are the goal: they decide which components and how many. See <a href="../estimation/index.html">estimating compute and choosing a database</a> for the method and calculators.</p>';

    if (C.api) h += '<h2 id="api">3. API design</h2>' + table(['Endpoint / call', 'Purpose and notes'], C.api, function (c, i) { return i === 0 ? '<code>' + esc(dec(c)) + '</code>' : c; });

    h += '<h2 id="data">4. Data model and database choice</h2>';
    if (C.data) h += table(['Entity', 'Store', 'Key fields and notes'], C.data);
    if (C.dbChoice) h += '<h3>Choosing the databases</h3>' + table(['Data', 'Choice', 'Why', 'Alternatives considered'], C.dbChoice);

    h += '<h2 id="architecture">5. High-level architecture</h2>';
    h += '<div class="demo" id="arch-demo"><h3>Architecture and request flows</h3><div class="flowtabs"></div><p class="flowdesc"></p><div class="stage"></div></div>' + legend();
    if (C.components) h += table(['Component', 'Responsibility'], C.components);
    if (C.evolution) h += '<h3 id="evolution">' + (C.evolutionTitle || 'How the design evolves') + '</h3><div class="demo" id="evo-demo"><div class="flowtabs"></div><p class="flowdesc"></p><div class="stage"></div></div>';

    if (C.deep) { h += '<h2 id="deep-dives">6. Deep dives</h2>'; C.deep.forEach(function (d) { h += '<div class="card arch"><h3>' + d[0] + '</h3>' + d[1] + '</div>'; }); }
    if (C.scale) h += '<h2 id="scaling">7. Scaling and bottlenecks</h2><ul>' + C.scale.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    if (C.tradeoffs) h += '<h2 id="tradeoffs">8. Key trade-offs</h2>' + table(['Decision', 'Options', 'Choice and why'], C.tradeoffs);
    if (C.failures) h += '<h2 id="failures">9. Failure modes and mitigations</h2>' + table(['What fails', 'Mitigation'], C.failures);
    if (C.evals) h += '<h2 id="evaluation">Evaluation metrics</h2><p>How to know the system is good, and stays good. Definitions and calculators are on the <a href="../ai-evaluation/index.html">AI evaluation page</a>.</p>' +
      table(['Metric', 'What it measures', 'Target / how to measure'], C.evals);

    h += '<h2 id="cloud">10. Azure and AWS reference</h2>';
    h += '<p>The same logical architecture maps onto either cloud. Service names and links were checked in October 2026; cloud catalogues change, so confirm before you build.</p>';
    h += table(['Component', 'Azure', 'AWS'], (C.cloud || []).map(function (r) {
      var key = r[1], c = CAT[key];
      if (r.length >= 3) return [r[0], CAT[r[1]] ? svcHtml(r[1], 'az') : r[1], CAT[r[2]] ? svcHtml(r[2], 'aws') : r[2]];
      return [r[0], c ? svcHtml(key, 'az') : key, c ? svcHtml(key, 'aws') : key];
    }));
    h += '<div class="cloud-cols"><div class="card arch"><h3>Azure references</h3><ul>' + (C.refs && C.refs.az || []).map(function (k) { return '<li>' + refHtml(k) + '</li>'; }).join('') +
      '</ul></div><div class="card arch"><h3>AWS references</h3><ul>' + (C.refs && C.refs.aws || []).map(function (k) { return '<li>' + refHtml(k) + '</li>'; }).join('') + '</ul></div></div>';

    if (C.questions) {
      h += '<h2 id="questions">11. Interview follow-up questions</h2>';
      C.questions.forEach(function (q) { h += '<details class="prob"><summary>' + q[0] + '</summary><p>' + q[1] + '</p></details>'; });
    }
    if (C.related) h += '<h2 id="related">Related designs</h2><p>' + C.related.map(function (s) { var m = ALL.filter(function (a) { return a[0] === s; })[0]; return m ? '<a href="../' + s + '/index.html">' + m[1] + '</a>' : ''; }).join(' &middot; ') + '</p>';
    h += '<div class="pager"><a href="' + nav.prev[0] + '">&larr; ' + nav.prev[1] + '</a><a href="' + nav.next[0] + '">' + nav.next[1] + ' &rarr;</a></div>';

    $root.html(h);
    $root.find('table').filter(function () { return !$(this).parent().hasClass('table-wrap'); }).wrap('<div class="table-wrap"></div>');   // tables inside deep-dive HTML scroll on phones
    flows('#arch-demo', C.diagram, C.flows);
    if (C.evolution) multi('#evo-demo', C.evolution);
  }

  // concept pages: header nav + pager from the index
  function pageChrome(slug) {
    var nav = navFor(slug, '../');
    $('header.top nav').html('<a href="../index.html">System design home</a><a href="' + nav.prev[0] + '">&larr; Previous</a><a href="' + nav.next[0] + '">Next &rarr;</a>');
    $('.pager').html('<a href="' + nav.prev[0] + '">&larr; ' + nav.prev[1] + '</a><a href="' + nav.next[0] + '">' + nav.next[1] + ' &rarr;</a>');
  }

  return { CAT: CAT, REF: REF, FUND: FUND, CASES: CASES, ALL: ALL, diagram: diagram, flows: flows, multi: multi, flowFrames: flowFrames, legend: legend,
           renderCase: renderCase, pageChrome: pageChrome, svcHtml: svcHtml, refHtml: refHtml, links: links, table: table };
})(jQuery);
