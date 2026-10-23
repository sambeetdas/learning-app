$(function () {
  'use strict';

  var STEP_MS = 2600;

  // Each use case is solved by chaining several models, each covering the weakness of the previous one.
  var CASES = {
    fraud: {
      tab: 'Fraud detection',
      goal: 'Block fraudulent card payments in under 100 ms without declining good customers. Only about 0.1% of transactions are fraud.',
      why: 'Each stage covers the weakness of the others: rules are fast but rigid, anomaly detection needs no labels, the classifier is precise on known fraud, and humans handle the grey zone.',
      stages: [
        { name: 'Transaction stream', tech: 'Kafka + feature store', text: 'Millions of events a day. Each one is enriched in real time with features: amount, merchant, device, location, and "velocity" counts such as how many payments this card made in the last hour.' },
        { name: 'Rules and blocklists', tech: 'if-then rules', text: 'Cheap, instant and explainable: stolen-card lists, impossible travel, sanctioned countries. Handles hard business and legal constraints that should never be left to a model.' },
        { name: 'Anomaly detector', tech: 'Isolation Forest / autoencoder (unsupervised)', text: 'Needs no labels. Scores how unusual a transaction is compared with normal behaviour, so it can flag brand-new fraud tricks that no labelled example covers yet.' },
        { name: 'Fraud classifier', tech: 'Gradient boosting (XGBoost / LightGBM)', text: 'Trained on past labelled fraud and given the anomaly score as an extra feature. Fraud is rare, so it uses class weights or resampling and is judged on PR-AUC and recall at a fixed false-positive rate, not accuracy.' },
        { name: 'Decision thresholds', tech: 'cost-based thresholds', text: 'Low risk: approve. High risk: block. In between: step-up check (3-D Secure, SMS code) or manual review. Thresholds are set from the cost of a missed fraud versus the cost of annoying a good customer.' },
        { name: 'Review and feedback', tech: 'human in the loop + retraining', text: 'Chargebacks and analyst decisions become new labels. Models retrain on a schedule, and drift monitors watch for fraudsters changing tactics.' }
      ]
    },
    recsys: {
      tab: 'Recommendations',
      goal: 'Show each of 50 million users the best 20 items out of 10 million, in about 100 ms.',
      why: 'No single model can score every item for every user in time. A fast, coarse model narrows millions to hundreds; a slower, more accurate model ranks only those; final rules shape the list.',
      stages: [
        { name: 'Behaviour logs', tech: 'clicks, views, purchases', text: 'Implicit feedback (clicks, watch time, purchases) is far more plentiful than ratings. Logs feed training and also real-time user features.' },
        { name: 'Candidate generation', tech: 'two-tower embeddings + ANN search / matrix factorization', text: 'Users and items are mapped to vectors so that related ones are close together. An approximate-nearest-neighbour index finds the ~500 closest items in milliseconds. Popular and content-based candidates cover new users and new items (cold start).' },
        { name: 'Ranking model', tech: 'Gradient boosting or deep ranking network', text: 'A heavier model predicts click or watch probability for each of the 500 using rich features: user history, item details, context (device, time of day) and their interactions.' },
        { name: 'Re-ranking', tech: 'rules + diversity optimisation', text: 'Remove already-seen and unsafe items, avoid ten near-identical results, boost fresh content, and apply business rules such as sponsored slots or stock availability.' },
        { name: 'Serve and explore', tech: 'bandit / A/B testing', text: 'Mostly show the best-ranked items, but reserve a little traffic for exploration so the system keeps learning about items it knows little about.' },
        { name: 'Feedback loop', tech: 'online metrics', text: 'What users do next becomes training data. Success is judged online (conversion, retention) through A/B tests, because offline accuracy often does not predict it.' }
      ]
    },
    churn: {
      tab: 'Customer churn',
      goal: 'Reduce subscription cancellations within a fixed retention budget.',
      why: 'Predicting who will leave is not enough. The valuable question is who can be persuaded to stay, and that needs a different model on top of the churn model.',
      stages: [
        { name: 'Customer data', tech: 'usage, billing, support tickets', text: 'Build one row per customer per time window: activity trends, payment failures, support contacts, plan changes, tenure. Careful: only use information available before the cancellation date (leakage).' },
        { name: 'Segmentation', tech: 'k-means / clustering (unsupervised)', text: 'Group customers by behaviour (power users, occasional users, price-sensitive...). Segments guide different offers and can be added as a feature for the next model.' },
        { name: 'Churn model', tech: 'Gradient boosting + survival analysis', text: 'Classifier: probability of leaving within 30 days. Survival model: when they are likely to leave, which handles customers who have not churned yet (censored data).' },
        { name: 'Uplift model', tech: 'causal ML (two-model / meta-learners)', text: 'Estimates how much an offer changes each customer\'s behaviour. This separates "persuadables" from "sure things" (would stay anyway) and "lost causes", so the budget is not wasted.' },
        { name: 'Campaign optimiser', tech: 'ranking + budget constraint', text: 'Choose who gets which offer to maximise retained revenue within the budget, using expected uplift times customer value.' },
        { name: 'Controlled test', tech: 'A/B test with holdout', text: 'Keep a random holdout group that gets no offer. It is the only reliable way to measure whether the whole system actually saves customers.' }
      ]
    },
    maintenance: {
      tab: 'Predictive maintenance',
      goal: 'Detect machine problems early enough to schedule repairs, with very few recorded failures to learn from.',
      why: 'Failures are rare, so a pure classifier has little to learn from. Anomaly detection trained on healthy data works from day one, and supervised models take over as failure examples accumulate.',
      stages: [
        { name: 'Sensor streams', tech: 'IoT, time series', text: 'Vibration, temperature, current and pressure sampled many times per second, plus machine type, load and maintenance history.' },
        { name: 'Feature extraction', tech: 'rolling stats, FFT', text: 'Raw signals become informative features: rolling mean and variance, trend, peak frequencies (FFT), time since last service. Often matters more than the choice of model.' },
        { name: 'Anomaly detector', tech: 'autoencoder / Isolation Forest on healthy data', text: 'Learns what "normal" looks like and raises an alarm when the machine drifts away from it. Works without any failure labels, and can catch failure types never seen before.' },
        { name: 'Failure predictor', tech: 'Classifier + remaining-useful-life regression (GBDT / LSTM)', text: 'Once there are enough examples: probability of failure in the next 7 days, and an estimate of remaining useful life. Sequence models (LSTM, 1-D CNN) read the signal history directly.' },
        { name: 'Alert and schedule', tech: 'thresholds + optimisation', text: 'Alerts are combined (several signals agreeing beats one noisy one) and fed to a scheduler that plans repairs around production, spare parts and technician availability.' },
        { name: 'Work-order feedback', tech: 'labels from technicians', text: 'What the technician actually found becomes a label, improving both models and reducing false alarms over time.' }
      ]
    },
    forecast: {
      tab: 'Demand forecasting',
      goal: 'Predict weekly demand for 100,000 products across stores to decide how much stock to hold.',
      why: 'Statistical models capture trend and seasonality reliably; gradient boosting captures messy effects like promotions and weather; averaging them is usually better than either, and reconciliation keeps the numbers consistent.',
      stages: [
        { name: 'History and drivers', tech: 'sales + calendar + price + weather', text: 'Sales history plus everything known in advance: holidays, planned promotions, price changes, weather forecasts. Beware: never use information that would not be available at forecast time.' },
        { name: 'Baseline', tech: 'ETS / ARIMA / Prophet', text: 'A simple statistical model per series captures level, trend and seasonality. It is also the benchmark every fancier model must beat.' },
        { name: 'Residual model', tech: 'Gradient boosting with lag features', text: 'Learns what the baseline misses (promotion lifts, holiday shifts, cross-product effects) from lags, rolling averages and the external drivers, shared across many products.' },
        { name: 'Ensemble and reconcile', tech: 'weighted average + hierarchical reconciliation', text: 'Combine the models (averaging reduces variance), then make forecasts add up: store forecasts sum to the region total, SKUs to the category.' },
        { name: 'Uncertainty', tech: 'quantile regression / conformal prediction', text: 'Produce a range (for example P10 to P90), not just one number. Stock decisions depend on how wrong the forecast might be.' },
        { name: 'Inventory decision', tech: 'optimisation', text: 'Choose order quantities to balance holding cost against stock-outs, using the forecast range. Then monitor error (WAPE, bias) and retrain on new data.' }
      ]
    },
    rag: {
      tab: 'Knowledge assistant (RAG)',
      goal: 'Answer employee questions from thousands of internal documents, with sources, without making things up.',
      why: 'An LLM alone does not know your documents and may invent answers. Retrieval finds the facts, re-ranking picks the best, and the LLM only has to write them up, which can be checked against the sources.',
      stages: [
        { name: 'Documents', tech: 'PDFs, wikis, tickets', text: 'Collect, clean and split documents into chunks of a few hundred words, keeping metadata (title, date, access rights) for filtering.' },
        { name: 'Embed and index', tech: 'embedding model + vector database', text: 'A transformer turns each chunk into a vector capturing its meaning. Similar meaning means nearby vectors, so "refund policy" finds "returning purchases" even without shared words.' },
        { name: 'Hybrid retrieval', tech: 'BM25 keyword + vector search', text: 'Run keyword search (good at exact terms, codes, names) and vector search (good at meaning) together and merge the results. Each catches what the other misses.' },
        { name: 'Re-ranker', tech: 'cross-encoder model', text: 'A slower, more accurate model reads the question together with each of the top 50 chunks and keeps the best handful.' },
        { name: 'LLM answer', tech: 'large language model + prompt', text: 'The best chunks are placed in the prompt and the LLM writes an answer that cites them. The instruction says to answer only from the provided text and to say so when it is not there.' },
        { name: 'Guardrails and evaluation', tech: 'checks + test set + feedback', text: 'Verify the answer is grounded in the sources, filter sensitive data, and enforce user permissions. Measure with a fixed question set (retrieval hit rate, answer faithfulness) and thumbs up/down.' }
      ]
    }
  };

  var current = null, idx = -1, timer = null;
  var $tabs = $('#pl-tabs'), $stages = $('#pl-stages');

  Object.keys(CASES).forEach(function (key) {
    $('<button type="button">').text(CASES[key].tab).attr('data-case', key).appendTo($tabs);
  });

  function stop() { clearInterval(timer); timer = null; $('#pl-play').text('Play'); }

  function show(i) {
    var c = CASES[current];
    idx = i;
    $stages.children().each(function (n) {
      $(this).toggleClass('active', n === i).toggleClass('done', n < i);
    });
    var $cap = $('#pl-caption').empty();
    if (i < 0) {
      $cap.append($('<b>').text('Goal: '), document.createTextNode(c.goal));
    } else {
      var s = c.stages[i];
      $cap.append($('<b>').text('Step ' + (i + 1) + ' of ' + c.stages.length + ': ' + s.name), $('<br>'),
                  $('<span class="muted">').text(s.tech), $('<br>'), document.createTextNode(s.text));
    }
    $('#pl-bar').css('width', (i < 0 ? 0 : (i + 1) / c.stages.length * 100) + '%');
    $('#pl-why').text(i === c.stages.length - 1 ? 'Why combine them? ' + c.why : '');
    $('#pl-prev').prop('disabled', i < 0);
    $('#pl-next').prop('disabled', i >= c.stages.length - 1);
  }

  function load(key) {
    stop(); current = key;
    $tabs.children().removeClass('active').filter('[data-case="' + key + '"]').addClass('active');
    $stages.empty();
    CASES[key].stages.forEach(function (s, n) {
      $('<div class="stage">').attr('data-i', n).append($('<b>').text(s.name), $('<small>').text(s.tech)).appendTo($stages);
    });
    show(-1);
  }

  function advance() {
    if (idx >= CASES[current].stages.length - 1) { stop(); return; }
    show(idx + 1);
    if (idx >= CASES[current].stages.length - 1) stop();
  }

  $tabs.on('click', 'button', function () { load($(this).data('case')); });
  $stages.on('click', '.stage', function () { stop(); show(+$(this).data('i')); });
  $('#pl-next').on('click', function () { stop(); advance(); });
  $('#pl-prev').on('click', function () { stop(); show(idx - 1); });
  $('#pl-play').on('click', function () {
    if (timer) { stop(); return; }
    if (idx >= CASES[current].stages.length - 1) show(-1);
    advance();
    timer = setInterval(advance, STEP_MS);
    $(this).text('Pause');
  });

  load('fraud');
});
