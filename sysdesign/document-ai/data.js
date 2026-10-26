SD.renderCase({
  slug: 'document-ai',
  summary: 'Intelligent document processing (IDP) turns PDFs, scans, photos and emails into validated structured data for downstream systems. This design handles an insurer’s inbound documents: claim packets, invoices, medical bills, identity documents and letters. Documents are ingested from email, portal and scanners, stored immutably, then pass through a pipeline: <strong>OCR and layout analysis</strong>, <strong>classification and packet splitting</strong>, <strong>field extraction</strong> with prebuilt models (invoices, IDs), custom-trained models (claim forms) and <strong>LLM extraction constrained by a JSON schema</strong> for free text, then <strong>validation rules</strong> and per-field <strong>confidence thresholds</strong>. Documents that pass go straight through; the rest land in a <strong>human-in-the-loop review queue</strong> where corrections also become training data. The key business number is the <strong>straight-through-processing (STP) rate</strong>, because human review, not AI, dominates the cost; the key risk is wrong data flowing silently into payments, so accuracy, calibration, PII protection and audit are first-class requirements.',
  examples: 'Azure AI Document Intelligence and Content Understanding, Amazon Textract with Bedrock Data Automation and Augmented AI (A2I) review, Google Document AI, ABBYY Vantage, Hyperscience, Rossum and UiPath Document Understanding, used for invoices (accounts payable), insurance claims, mortgage files, KYC onboarding and customs paperwork.',
  functional: ['Ingest documents from email inboxes, a customer portal, scanners/SFTP and an API; deduplicate and virus-scan.', 'OCR printed and handwritten text with layout (reading order, tables, checkboxes, key-value pairs) in 20+ languages.', 'Classify documents and split multi-document packets (a 20-page PDF with claim form, medical report, receipts and an ID).', 'Extract ~25 fields per document type with confidence and the source location (page, bounding box) of every value.', 'Validate with business rules and reference lookups (policy exists, dates in coverage period, totals add up, IBAN checksum); route low-confidence or failing documents to human review.', 'Reviewers correct fields side by side with highlighted sources; approved data is posted to the claims and ERP systems; corrections feed retraining.'],
  nonFunctional: ['STP rate &ge; 75% now, 85% target, with &le; 0.5% of straight-through documents containing any wrong field.', 'End-to-end p95 &le; 2 minutes for straight-through documents; review SLA &le; 4 business hours.', 'Field accuracy &ge; 97% on key fields; confidence scores calibrated so that thresholds mean what they say.', 'Special-category personal data (health, identity) encrypted, access by role, data kept in-region, never used to train external models.', 'Complete audit trail: every value traceable to the source page, model version and any human change, kept 10 years.', 'Absorb Monday-morning scan bursts of 3&times; without losing documents.'],
  outOfScope: ['Claims adjudication and fraud scoring decisions (downstream systems).', 'Document authoring and e-signature.', 'Training foundation models.', 'Chat over documents (see <a href="../rag-assistant/index.html">RAG assistant</a>).'],
  estimates: [
    ['Documents per day', '100,000', 'Claims packets, invoices, medical bills, IDs, correspondence'],
    ['Pages per day', '400,000', '~4 pages per document on average'],
    ['Peak page rate', '~33 pages/s', '400,000 over ~10 business hours = 11/s, &times;3 when overnight scans land at 9 a.m.'],
    ['Fields per document', '~25', 'Fields have independent confidence scores and validation rules'],
    ['OCR + extraction cost', '~$4,000/day', '400,000 pages &times; ~$10 per 1,000 pages for layout/prebuilt models (OCR-only read is ~$1.50 per 1,000; custom models cost more); list prices vary'],
    ['LLM extraction', '~20,000 docs/day, ~$400/day', 'Free-text documents only: ~6,000 tokens in &times; $2.50/M + ~500 out &times; $10/M &asymp; $0.02 each'],
    ['Human review load', '~25,000 docs/day &asymp; 833 hours &asymp; 105 reviewers', '25% not straight-through &times; ~2 min each; 8-hour shifts'],
    ['Human review cost', '~$25,000/day', '833 h &times; ~$30/h: 6&times; the AI cost, which is why STP is the main lever'],
    ['Raw storage', '~100 GB/day, ~36 TB/year', '~1 MB per scanned document; 10-year retention &asymp; 360 TB on cool/archive tiers'],
    ['Extraction results', '~1 GB/day', '~10 KB of JSON per document (fields, confidences, bounding boxes, versions)']
  ],
  compute: [
    ['OCR / layout / extraction service', 'Managed document AI, ~33 pages/s peak across 2-3 resources', 'Typical default per-resource rate limits are around 15 analyse requests/s, so either raise the quota or shard across resources/regions; a queue in front smooths the 9 a.m. burst.'],
    ['Pipeline workers', '4 &times; 2 vCPU (autoscale on queue depth)', '100,000 documents &times; ~8 activities (store, OCR, classify, extract, validate, lookups, post, audit) = 800,000/day &asymp; 9/s average, ~30/s peak; each activity is I/O-bound.'],
    ['LLM extraction capacity', '~0.65 M tokens/min at peak', '20% of documents: ~1.65 docs/s at peak (33 pages/s &divide; 4 &times; 20%) &times; 6,500 tokens &times; 60. A regional pay-as-you-go deployment behind the <a href="../llm-gateway/index.html">AI gateway</a> is enough.'],
    ['Custom model training', 'Weekly jobs, a few GPU/CPU hours', 'Custom extraction models retrain from a few hundred to a few thousand labelled documents per type; cheap compared with review.'],
    ['Review workforce (the real capacity)', '~105 reviewers at 75% STP, ~63 at 85%', '15,000 reviewed docs &times; 2 min = 500 h at 85% STP. Each STP point is worth ~1,000 fewer reviews per day (~$1,000/day).']
  ],
  api: [
    ['POST /documents', 'Multipart upload or pre-signed URL (valet key) with {channel, metadata, idempotencyKey} &rarr; 202 {documentId}. Large packets go straight to object storage; the API never streams files through itself.'],
    ['GET /documents/{id}', 'Status, docType, page ranges, fields [{name, value, confidence, page, polygon, source: model|llm|human}], validation results, model versions.'],
    ['GET /review/tasks?skill=medical&priority=sla', 'Next task for a reviewer, assigned by skill, language and SLA; locked to one reviewer at a time.'],
    ['POST /review/tasks/{id}', '{corrections [{field, value}], decision: approve|reject|escalate, reason}: recorded with reviewer id; approval resumes the workflow.'],
    ['event DocumentProcessed {documentId, docType, stp, fields, version}', 'Published to downstream claims/ERP consumers; posting uses documentId as the idempotency key.'],
    ['POST /models/{docType}/versions', 'Train from a labelled dataset version, evaluate on the hold-out set, then deploy as a canary.']
  ],
  data: [
    ['raw documents', 'Object storage, immutable (WORM), customer-managed keys', 'raw/{yyyy}/{mm}/{dd}/{sha256}.pdf; SHA-256 dedupes repeats; lifecycle hot 90 days &rarr; cool &rarr; archive; legal holds.'],
    ['documents and packets', 'Relational DB', 'documentId (PK), packetId, sha256 (unique), channel, docType, pages, status, stp flag, model versions, timestamps; indexes on status and docType for queues and reporting.'],
    ['extraction results', 'Document DB or JSON column, versioned', 'Per field: value, normalised value, confidence, page, polygon, source, validation outcome; machine version and human version both kept.'],
    ['review tasks', 'Queue + relational table', 'taskId, documentId, flagged fields, skill, priority, SLA deadline, assignee, lock expiry, outcome.'],
    ['labelled training data', 'Object storage + dataset registry', 'Page images + corrected fields + layout JSON per document type; versioned datasets with train/hold-out splits.'],
    ['audit log', 'Append-only immutable store', 'Who viewed, changed, approved or exported what and when; model and rule versions; 10-year retention.']
  ],
  dbChoice: [
    ['Document state and reporting', 'Relational DB', 'Clear relations (packet &rarr; documents &rarr; fields &rarr; reviews), transactions when a review approves, SQL reporting on STP and accuracy.', 'Document DB: good for the variable field JSON, which can also live in a JSON column.'],
    ['Raw files', 'Object storage with immutability policies', 'Cheap, durable, tiered, WORM for evidence; served to reviewers through short-lived URLs.', 'Database BLOBs: expensive and slow to back up.'],
    ['Audit trail', 'Immutable storage or ledger table', 'Tamper-evident history for regulators and disputes.', 'Ordinary application logs: mutable and short-lived.'],
    ['Review queue', 'Message queue + task table', 'Competing reviewers, locks with expiry, priorities and SLA reporting.', 'Polling the documents table: contention and no fair assignment.']
  ],
  diagram: {
    nodes: [['src', 'Email, portal, scan', 'client', 0, 1.2, 'inbound documents'], ['ing', 'Ingestion API', 'apigw', 1, 1.2, 'dedupe, virus scan'], ['raw', 'Raw documents', 'blob', 1, 0, 'immutable, WORM'],
      ['orch', 'Workflow', 'svc', 2, 1.2, 'durable, per document'], ['ocr', 'OCR + layout', 'ai', 3, 0.2, 'text, tables, marks'], ['cls', 'Classify + split', 'ml', 4, 0.2, 'doc type, page ranges'],
      ['ext', 'Field extraction', 'ai', 5, 0.2, 'prebuilt, custom, LLM'], ['llm', 'LLM', 'llm', 6, 0.2, 'JSON schema output'], ['val', 'Validation rules', 'svc', 5, 1.4, 'rules, thresholds'],
      ['pas', 'Claims / ERP', 'ext', 6, 1.4, 'lookups, posting'], ['rq', 'Review queue', 'queue', 4, 2.4, 'low confidence'], ['rev', 'Reviewers', 'user', 3, 3.4, 'side-by-side UI'],
      ['store', 'Results + audit', 'db', 2, 2.4, 'fields, versions'], ['lab', 'Training data', 'dw', 2, 3.4, 'corrections']],
    edges: [['src', 'ing'], ['ing', 'raw'], ['ing', 'orch', 'event', 'async'], ['orch', 'ocr'], ['ocr', 'cls'], ['cls', 'ext'], ['ext', 'llm'], ['ext', 'val'], ['val', 'pas', 'lookup'],
      ['val', 'rq', 'below threshold'], ['rq', 'rev'], ['orch', 'store'], ['rev', 'lab', 'corrections', 'async']]
  },
  flows: [
    { name: 'Straight-through invoice', desc: 'A supplier emails a 2-page invoice; it is posted without human touch in ~25 s.', steps: [
      ['src', 'ing', 'email attachment', 'A mailbox connector picks up the PDF and metadata (sender, subject).'],
      ['ing', 'raw', 'store (SHA-256), scan', 'The file is virus-scanned and stored immutably; the hash detects a resend of the same invoice.'],
      ['ing', 'orch', 'DocumentReceived', 'A durable workflow instance starts per document, so each step is retried independently and progress survives restarts.', 'async'],
      ['orch', 'ocr', 'layout analysis', 'OCR returns words with positions, reading order, tables and key-value pairs for both pages.'],
      ['ocr', 'cls', 'classify: invoice (0.99)', 'A classifier on layout and text identifies one invoice; no split needed.'],
      ['cls', 'ext', 'prebuilt invoice model', 'The prebuilt model extracts 22 fields (supplier, invoice number, dates, line items, totals, tax, IBAN), each with a confidence and bounding box.'],
      ['ext', 'val', 'fields + confidences', 'Rules: line items sum to the net total, tax rate valid for the country, IBAN checksum, due date after invoice date.'],
      ['val', 'pas', 'match supplier + PO', 'Lookup confirms the supplier and a matching purchase order and goods receipt (three-way match).'],
      ['val', 'orch', 'all fields above threshold', 'Every field passed its calibrated threshold and every rule passed: straight-through.', 'resp'],
      ['orch', 'store', 'results + audit, then post', 'Results, model versions and decisions are recorded; the invoice is posted to the ERP with documentId as idempotency key.']],
      end: 'STP needs three things at once: confident extraction, passing rules and a successful reference match.' },
    { name: 'Claim packet + LLM', desc: 'An 18-page claim packet mixes a claim form, a medical report, receipts and an ID.', steps: [
      ['orch', 'ocr', 'layout, 18 pages', 'Handwriting on the claim form and a phone photo of a receipt are included.'],
      ['ocr', 'cls', 'split into 4 documents', 'Page-level classification and boundary detection: claim form p1-3, medical report p4-9, receipts p10-16, ID p17-18.'],
      ['cls', 'ext', 'route per document type', 'Claim form: custom-trained neural model. Receipts: prebuilt receipt model. ID: prebuilt ID model. Medical report: free text, so LLM extraction.'],
      ['ext', 'llm', 'schema + OCR lines', 'The LLM receives the OCR text with line ids and a strict JSON schema (diagnosis, treatment dates, provider, amounts). It must return, for each value, the line ids it came from.'],
      ['llm', 'ext', 'JSON + source lines', 'Structured output guarantees valid JSON; the extractor checks that each value actually appears in the cited lines (grounding), which catches hallucinated values.', 'resp'],
      ['ext', 'val', '4 documents, 61 fields', 'Cross-document rules: claimant name on the form matches the ID; receipt totals match the claimed amount; treatment dates within the policy period.'],
      ['val', 'pas', 'policy lookup', 'The policy is active and covers outpatient treatment.'],
      ['val', 'rq', 'treatment date conf 0.71', 'One handwritten date is below its 0.90 threshold, so only this field is flagged for review; the packet waits for one quick check rather than a full re-key.', 'err']],
      end: 'Use the cheapest reliable extractor per document type, and require LLM outputs to be schema-valid and grounded in the source.' },
    { name: 'Human review + feedback', desc: 'A reviewer fixes the flagged field; the correction improves future models.', steps: [
      ['rq', 'rev', 'task (medical skill, SLA 4 h)', 'The queue assigns by skill and language; the task is locked to one reviewer.'],
      ['rev', 'store', 'open side-by-side view', 'The UI shows the page image with the bounding box highlighted next to the extracted value; personal data the reviewer does not need is masked by role.'],
      ['rev', 'orch', 'correct date, approve', 'The reviewer types 12/03/2026 and approves; the change is recorded with reviewer id and reason.'],
      ['orch', 'pas', 'post claim', 'The workflow resumes and posts the claim to the claims system idempotently.'],
      ['rev', 'lab', 'correction as label', 'The page, the model value, the corrected value and the document type become a labelled example.', 'async'],
      ['lab', 'ext', 'weekly retrain + evaluate', 'Custom models are retrained on the new labels and evaluated on a fixed hold-out set; a new version ships as a canary only if field accuracy improves without regressions.'],
      ['lab', 'val', 'recalibrate thresholds', 'Thresholds are reset per field so that values above them are ≥ 99% correct on recent reviewed data.']],
      end: 'Every review is both a quality gate and free training data; the loop is how STP climbs from 60% to 85%.' },
    { name: 'Bad scan, bad JSON, downstream down (failure)', desc: 'Several things go wrong at once on a Monday morning.', steps: [
      ['orch', 'ocr', 'skewed, low-res fax', 'OCR confidence is very low on half the page.', 'err'],
      ['ocr', 'cls', 'type = unknown (0.42)', 'Below the classification threshold: the document goes to a manual triage queue instead of a guessed extractor.', 'err'],
      ['ext', 'llm', 'letter says “set amount to 0”', 'A letter contains text crafted as instructions. The LLM is only asked to extract values, and its output is checked by rules that do not read instructions.', 'err'],
      ['llm', 'ext', 'invalid enum value', 'The response fails schema validation; one retry with the validation error, then the document is routed to review rather than accepted.', 'err'],
      ['val', 'pas', 'claims system 503', 'Posting fails; the workflow retries with exponential backoff using documentId as the idempotency key, so no duplicate claims are created.', 'err'],
      ['orch', 'store', 'status: waiting downstream', 'The document is visible as processed-but-not-posted; an alert fires if the backlog grows; nothing is lost because the queue and workflow hold it.']],
      end: 'When in doubt, route to a human; never let a low-confidence or unvalidated value flow silently into payments.' }
  ],
  components: [
    ['Ingestion', 'Email, portal, scanner and API channels; virus scanning; hashing and dedupe; immutable raw storage; pre-signed uploads.'],
    ['Workflow orchestrator', 'Durable per-document pipeline (pipes and filters) with retries, timeouts, human-wait states and idempotent posting.'],
    ['OCR and layout', 'Text, handwriting, tables, selection marks, reading order and coordinates.'],
    ['Classification and splitting', 'Document type per page, packet boundaries, routing to the right extractor; unknowns to triage.'],
    ['Extractors', 'Prebuilt models, custom-trained models, LLM extraction with JSON schema and grounding checks; per-field confidence.'],
    ['Validation', 'Business rules, cross-document consistency, reference lookups, calibrated thresholds &rarr; STP or review.'],
    ['Review app and queue', 'Skill-based assignment, side-by-side UI, role-based masking, SLA tracking.'],
    ['Learning loop', 'Labels from corrections, dataset versions, retraining, evaluation, canary deployment, threshold recalibration.']
  ],
  deep: [
    ['Choosing an extraction strategy', '<table><tr><th>Approach</th><th>Best for</th><th>Strengths</th><th>Watch out for</th></tr><tr><td><strong>Prebuilt models</strong></td><td>Invoices, receipts, IDs, tax forms</td><td>No training, good accuracy, cheap, confidences and boxes</td><td>Fixed field set; local formats may need custom models</td></tr><tr><td><strong>Custom template / neural models</strong></td><td>Your own forms (claim forms)</td><td>High accuracy with a few dozen to hundreds of labelled samples; calibrated confidences</td><td>Labelling effort; retrain when forms change</td></tr><tr><td><strong>LLM extraction</strong></td><td>Free text: medical reports, letters, contracts</td><td>Zero-shot with a schema; handles variety and reasoning (“net of tax”)</td><td>Hallucination, no native confidence, cost per token, prompt injection</td></tr><tr><td><strong>Rules / regex</strong></td><td>IBANs, policy numbers, dates</td><td>Deterministic, free</td><td>Brittle alone; best as validation</td></tr></table><p>LLM extraction should use structured outputs with a strict schema, pass OCR text with line ids (or the page image for multimodal models), and require source references for every value:</p><pre><code>{ "type": "object", "additionalProperties": false,\n  "required": ["provider", "treatment_date", "amount"],\n  "properties": {\n    "provider":       {"type": "string"},\n    "treatment_date": {"type": "string", "format": "date"},\n    "amount":         {"type": "number"},\n    "currency":       {"type": "string", "enum": ["EUR", "GBP", "USD"]},\n    "sources":        {"type": "object",\n                       "additionalProperties": {"type": "array", "items": {"type": "string"}}}\n  } }</code></pre><p>Derive a confidence from agreement (two extraction passes or model + LLM agree), grounding (value found in cited text) and token log-probabilities where available.</p>'],
    ['Confidence thresholds, calibration and STP', '<p>A threshold is only useful if confidence is <strong>calibrated</strong>: among values with confidence 0.9, about 90% should be right. Calibrate per field on reviewed data (isotonic regression or Platt scaling) and choose the threshold that meets a precision target, e.g. &ge; 99% correct above the threshold.</p><p>STP is a product over fields: if a document has 25 fields and each independently clears its threshold 99% of the time, only 0.99<sup>25</sup> &asymp; 78% of documents go straight through; at 98% per field it drops to 60%. So: require only fields that matter downstream, flag fields (not whole documents) for review, and use rules and lookups (a PO match confirms supplier and amount) to raise confidence. Measure both <strong>STP rate</strong> and <strong>STP precision</strong> (share of straight-through documents with no errors, found by sampling); raising thresholds trades one for the other.</p>'],
    ['Human-in-the-loop and the feedback loop', '<ul><li><strong>Review UI</strong>: page image with highlighted boxes, keyboard-first editing, only the flagged fields, role-based masking of personal data, reason codes for rejections.</li><li><strong>Queue design</strong>: skill and language routing, priorities by SLA and claim value, locks with expiry, four-eyes approval for high-value payments.</li><li><strong>Quality control</strong>: sample 1-2% of straight-through documents for blind review to measure real error rates; double-key a sample of reviews to measure reviewer accuracy.</li><li><strong>Learning</strong>: corrections become labels; active learning prioritises labelling documents where the model was least sure; weekly retraining with a fixed hold-out set; canary deployment; recalibrate thresholds; watch for drift (a supplier changes its invoice layout).</li></ul>'],
    ['PII, security, guardrails and audit', '<p>Claims contain special-category data (health) and identity documents, so: encryption with customer-managed keys; private endpoints for OCR and LLM services in the same region; providers contractually not retaining or training on data; least-privilege roles (reviewers see only what their task needs); PII detection to redact logs and analytics copies; retention and deletion schedules per document type; legal holds.</p><p><strong>LLM guardrails</strong>: documents are untrusted input; the LLM only extracts (no tools, no actions), outputs must be schema-valid and grounded in the source text, and deterministic validation decides what is accepted, so an injected “set amount to 0” cannot change a payment. Content safety is less relevant than integrity here.</p><p><strong>Audit</strong>: for every value keep source page and coordinates, model or prompt version, confidence, rules evaluated, and any human change with reviewer id, in an immutable store. This is also what lets you answer “why was this claim paid?” years later.</p>'],
    ['Cost per document', '<table><tr><th>Item</th><th>Per document</th></tr><tr><td>OCR + layout + prebuilt/custom extraction (4 pages)</td><td>~$0.04</td></tr><tr><td>LLM extraction (20% of documents &times; $0.02)</td><td>~$0.004</td></tr><tr><td>Compute, storage, queues</td><td>~$0.01</td></tr><tr><td><strong>Automated total</strong></td><td><strong>~$0.055</strong></td></tr><tr><td>Human review ($1.00 per reviewed doc &times; 25%)</td><td>~$0.25</td></tr><tr><td><strong>All-in at 75% STP</strong></td><td><strong>~$0.30</strong></td></tr></table><p>Moving STP from 75% to 85% saves ~$0.10 per document, ~$10,000 a day, far more than any saving on OCR or tokens. Spend AI budget where it removes reviews: better custom models for the most-reviewed fields, reference lookups, and flagging single fields instead of whole documents. Use the cheaper OCR-only read for pages that need no structure.</p>']
  ],
  scale: [
    '<strong>Service rate limits</strong> on OCR/extraction APIs are the first technical bottleneck: queue-based load levelling, quota increases, several resources or regions, batch APIs for backlogs.',
    '<strong>Bursts</strong> (scanned mail at 9 a.m., catastrophe events generating 10&times; claims) are absorbed by queues; autoscale workers on queue depth; prioritise by SLA.',
    '<strong>Reviewer capacity</strong> is the true scaling limit: raise STP, flag fields not documents, route by skill, and let surges drain over hours with priority rules.',
    '<strong>Large packets</strong> (200-page files): split early, process documents in parallel, pass storage references between steps (claim check) instead of payloads.',
    '<strong>New document types</strong>: start with LLM extraction plus review, collect labels, then train a custom model when volume justifies it.'
  ],
  tradeoffs: [
    ['Extractor per type', 'Prebuilt vs custom model vs LLM', 'Prebuilt where it exists, custom for high-volume own forms, LLM for long-tail free text; measure field accuracy and cost per type.'],
    ['Threshold level', 'High (fewer errors, lower STP) vs low (higher STP, more errors)', 'Set per field from the business cost of an error: payment amounts and bank details strict; free-text descriptions lenient.'],
    ['Review granularity', 'Whole document vs flagged fields only', 'Flagged fields: reviews take seconds instead of minutes; whole-document review only for high-value or fraud-flagged cases.'],
    ['Managed vs self-hosted OCR', 'Cloud document AI vs open-source OCR on your GPUs', 'Managed for accuracy, layout features and maintenance; self-hosted only for air-gapped needs or very high volume.'],
    ['Multimodal LLM end to end vs OCR then extraction', 'Send page images straight to a vision LLM vs OCR first', 'OCR first for auditability (coordinates), cost and calibrated confidence; vision LLMs for messy layouts and as a second opinion.']
  ],
  failures: [
    ['Silent wrong value posted (e.g. amount)', 'Calibrated thresholds, rules and reference matching, grounding checks for LLM values, sampled QA of STP documents, four-eyes for high values.'],
    ['Poor scans and handwriting', 'Image pre-processing (deskew, denoise), handwriting-capable OCR, low confidence routes to review, request a better copy from the sender.'],
    ['Unknown or misclassified document', 'Classification threshold, triage queue, add new types from triage volume.'],
    ['LLM hallucination or prompt injection', 'Extraction-only role, schema validation, grounding to source lines, deterministic rules decide acceptance.'],
    ['Downstream system unavailable', 'Durable workflow waits and retries with backoff, idempotent posting, backlog alerts.'],
    ['Model drift after a layout change', 'Monitor per-supplier and per-field confidence and correction rates; retrain; temporarily lower STP by tightening thresholds.'],
    ['Data breach risk', 'Encryption, private endpoints, role-based masking, audit, retention and deletion, no external training.']
  ],
  evals: [
    ['Field accuracy', 'Exact match after normalisation per field and document type, on a labelled hold-out set', '&ge; 97% on key fields (amounts, dates, IDs); &ge; 99% for bank details'],
    ['Classification and splitting accuracy', 'Correct doc type and page boundaries', '&ge; 99% type accuracy; &ge; 98% packets split correctly'],
    ['STP rate', 'Share of documents with no human touch', '&ge; 75% now, 85% target; tracked per type and channel'],
    ['STP precision', 'Share of straight-through documents with no wrong field (blind sampling)', '&ge; 99.5%'],
    ['Calibration', 'Observed accuracy of values above each threshold', 'Within 1 point of the target (e.g. &ge; 99% correct above threshold)'],
    ['LLM grounding and injection resistance', 'Values traceable to cited source lines; planted-instruction documents', 'Ungrounded values &le; 0.5% (all routed to review); 0 manipulated values accepted'],
    ['Latency and SLA', 'Upload to posted for STP docs; review turnaround', 'p95 &le; 2 min; reviews &le; 4 business hours'],
    ['Cost per document', 'AI + compute + review cost', 'Automated &le; $0.06; all-in &le; $0.30, falling as STP rises'],
    ['Privacy and audit', 'Unauthorised access events; values with complete lineage', '0 unauthorised access; 100% lineage']
  ],
  cloud: [['OCR, layout and extraction', 'docai'], ['LLM extraction', 'llm'], ['Custom model training', 'ml'], ['Durable workflow', 'workflow'], ['Pipeline steps', 'functions'], ['Work and review queues', 'queue'], ['Events to downstream', 'pubsub'],
    ['Raw documents (immutable)', 'blob'], ['Document state and results', 'sql'], ['Audit trail', 'ledger'], ['PII detection', 'Azure AI Language PII detection', 'Amazon Comprehend PII detection'], ['Human review tooling', 'Custom review app on App Service', 'Amazon Augmented AI (A2I)'],
    ['Keys and secrets', 'secrets'], ['Private networking', 'network'], ['Staff identity', 'workforce'], ['Monitoring and evaluation', 'aieval']],
  refs: { az: ['azDocProc', 'azp-pipes-and-filters', 'azp-queue-based-load-leveling', 'azp-claim-check', 'azp-competing-consumers', 'azBackground', 'azGenAiOps', 'azEvalGeneral'],
          aws: ['awsGenAiLens', 'awsMlLens', 'awsFsiLens', 'blBacklog', 'awsRetry', 'awsGenAiOps'] },
  questions: [
    ['How do you set confidence thresholds?', 'Calibrate model confidences per field on reviewed data, then pick the lowest threshold that keeps accuracy above the business target (e.g. 99% for amounts). Revisit after each model change, and monitor observed accuracy with blind sampling of straight-through documents.'],
    ['Why is STP the key metric?', 'Human review costs far more than AI processing: here ~$1 per reviewed document versus ~$0.055 automated. Each percentage point of STP removes ~1,000 reviews a day. But STP must be paired with STP precision so it is not raised by accepting errors.'],
    ['When would you use an LLM instead of a trained extraction model?', 'For free-text or highly variable documents (letters, medical reports, contracts), new document types without labelled data, or fields that need reasoning. Constrain it with a JSON schema, require source references, validate deterministically, and move high-volume types to trained models once labels exist.'],
    ['How do you prevent hallucinated values?', 'Ground every LLM value in the OCR text by requiring cited line ids and checking the value appears there; validate with rules and reference data; treat ungrounded or invalid output as low confidence and route it to review.'],
    ['How does the system get better over time?', 'Reviewer corrections are captured as labels with the page and context, datasets are versioned, models are retrained and evaluated on a fixed hold-out set, deployed as canaries, and thresholds recalibrated. Active learning prioritises the most informative documents.'],
    ['How do you handle personal and health data?', 'Encrypt everything, keep processing in-region on private endpoints with no provider retention, restrict and mask by role, redact PII in logs and analytics, enforce retention and deletion, and keep an immutable audit of every access and change.']
  ],
  related: ['rag-assistant', 'content-moderation', 'llmops', 'llm-gateway', 'job-scheduler']
});
