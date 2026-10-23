$(function () {
  'use strict';

  // ================================================================== 1. what happens inside PyTorch for c = a @ b
  (function () {
    var NODES = [
      { id: 'py',     label: 'Python',      sub: 'c = a @ b' },
      { id: 'tensor', label: 'Tensor',      sub: 'C++ object' },
      { id: 'disp',   label: 'Dispatcher',  sub: 'picks impl.' },
      { id: 'ag',     label: 'Autograd',    sub: 'records graph' },
      { id: 'aten',   label: 'ATen',        sub: 'operator lib' },
      { id: 'kern',   label: 'Kernel',      sub: 'cuBLAS / MKL' },
      { id: 'hw',     label: 'GPU / CPU',   sub: 'hardware' }
    ];
    var STEPS = [
      { from: 'py', to: 'tensor', text: 'You write c = a @ b in Python. a and b are torch.Tensor objects, thin Python wrappers around C++ data. Python calls Tensor.__matmul__, which jumps straight into compiled C++ through bindings. Python is only the steering wheel; no number crunching happens in Python.' },
      { from: 'tensor', to: 'disp', text: 'The C++ dispatcher looks at the "dispatch keys" of the inputs: device (CPU or CUDA), dtype (float32), layout (dense or sparse), and whether autograd is needed. From these it decides which implementation of matmul should run. This is how one API supports many devices.' },
      { from: 'disp', to: 'ag', text: 'Autograd layer: because a.requires_grad is True, the call is wrapped. After the real work is done, autograd creates a MatmulBackward node linked to a and b (remembering the inputs it will need later) and sets c.grad_fn. This is how the computation graph grows while your code runs.' },
      { from: 'ag', to: 'aten', text: 'ATen ("A Tensor library") is the core operator library: hundreds of ops (add, mm, conv2d, softmax...) with per-device implementations. For 2-D inputs, matmul resolves to mm.' },
      { from: 'aten', to: 'kern', text: 'A backend kernel is chosen: cuBLAS (or CUTLASS) on NVIDIA GPUs, MKL / oneDNN on Intel CPUs, hipBLAS on AMD ROCm, Metal on Apple MPS. These vendor libraries are hand-tuned for peak speed.' },
      { from: 'kern', to: 'hw', text: 'The kernel is launched on the GPU asynchronously, on the current CUDA stream. Memory for the result comes from PyTorch’s caching allocator, which reuses already-reserved blocks instead of calling the slow cudaMalloc each time.' },
      { from: 'hw', to: 'py', text: 'Python gets the result tensor c back immediately, while the GPU may still be computing. The CPU only waits when you need real values: c.item(), print(c), c.cpu(). That is why timing GPU code needs torch.cuda.synchronize().' }
    ];
    var i = -1, $nodes = $('#st-nodes');
    NODES.forEach(function (n) { $('<div class="node">').attr('data-id', n.id).append($('<strong>').text(n.label), $('<small>').text(n.sub)).appendTo($nodes); });
    function render() {
      $nodes.children().removeClass('from to');
      var $m = $('#st-msg').empty();
      if (i < 0) { $('#st-no').text('Ready'); $m.text('Press Next to follow one tensor operation down through the layers of PyTorch.'); }
      else {
        var s = STEPS[i];
        $nodes.children('[data-id="' + s.from + '"]').addClass('from'); $nodes.children('[data-id="' + s.to + '"]').addClass('to');
        $('#st-no').text('Step ' + (i + 1) + ' of ' + STEPS.length); $m.text(s.text);
      }
      $('#st-prev').prop('disabled', i < 0); $('#st-next').prop('disabled', i >= STEPS.length - 1);
    }
    $('#st-next').on('click', function () { if (i < STEPS.length - 1) { i++; render(); } });
    $('#st-prev').on('click', function () { if (i >= 0) { i--; render(); } });
    $('#st-reset').on('click', function () { i = -1; render(); });
    render();
  })();

  // ================================================================== 2. the training loop, line by line, with real numbers
  (function () {
    var X = 2, Y = 3, LR = 0.1, ITER = 5, snaps = [], i = 0;
    function f(v) { return v === null ? '–' : (Math.round(v * 1000) / 1000).toString(); }

    // Precompute every micro-step so Back and Next both work.
    var w = 0.5, pred = null, loss = null, grad = null, it;
    snaps.push({ line: -1, w: w, pred: pred, loss: loss, grad: grad, changed: [], msg: 'Start: the model has one weight, w = 0.5. The data is x = 2 with target y = 3, so the ideal weight is 1.5. Press Next to run the loop one line at a time.' });
    for (it = 1; it <= ITER; it++) {
      pred = w * X;
      snaps.push({ line: 0, it: it, w: w, pred: pred, loss: loss, grad: grad, changed: ['pred'], msg: 'Iteration ' + it + ' – forward pass: pred = w · x = ' + f(w) + ' · ' + X + ' = ' + f(pred) + '. Autograd records the multiply.' });
      loss = (pred - Y) * (pred - Y);
      snaps.push({ line: 1, it: it, w: w, pred: pred, loss: loss, grad: grad, changed: ['loss'], msg: 'Loss: (pred − y)² = (' + f(pred) + ' − ' + Y + ')² = ' + f(loss) + '. One number that says how wrong the model is.' });
      var stale = grad; grad = null;
      snaps.push({ line: 2, it: it, w: w, pred: pred, loss: loss, grad: grad, changed: ['grad'], msg: 'zero_grad(): clear w.grad' + (stale === null ? '' : ' (it still holds ' + f(stale) + ' from the last iteration; without this call new gradients would be ADDED to it)') + '.' });
      grad = 2 * (pred - Y) * X;
      snaps.push({ line: 3, it: it, w: w, pred: pred, loss: loss, grad: grad, changed: ['grad'], msg: 'backward(): w.grad = dLoss/dw = 2·(pred − y)·x = 2·(' + f(pred) + ' − ' + Y + ')·' + X + ' = ' + f(grad) + '. ' + (grad < 0 ? 'Negative: increasing w would reduce the loss.' : 'Positive: decreasing w would reduce the loss.') });
      var nw = w - LR * grad;
      snaps.push({ line: 4, it: it, w: nw, pred: pred, loss: loss, grad: grad, changed: ['w'], msg: 'step(): w = w − lr·w.grad = ' + f(w) + ' − ' + LR + '·' + f(grad) + ' = ' + f(nw) + '. The weight moved towards 1.5.' });
      w = nw;
    }
    snaps.push({ line: -1, w: w, pred: pred, loss: loss, grad: grad, changed: [], msg: 'After ' + ITER + ' iterations w = ' + f(w) + ', very close to the ideal 1.5. Real training does exactly this, with millions of weights, on batches of data, for many epochs.' });

    function render() {
      var s = snaps[i];
      $('#tl-code .cl').removeClass('active').filter('[data-line="' + s.line + '"]').addClass('active');
      var $t = $('#tl-state'); $t.find('td.v').each(function () {
        var k = $(this).data('k'); $(this).text(f(s[k])).toggleClass('chg', s.changed.indexOf(k) >= 0);
      });
      $('#tl-iter').text(s.it ? 'Iteration ' + s.it + ' of ' + ITER : (i === 0 ? 'Before training' : 'Finished'));
      $('#tl-msg').text(s.msg);
      $('#tl-prev').prop('disabled', i <= 0); $('#tl-next').prop('disabled', i >= snaps.length - 1);
    }
    var timer = null;
    function stop() { clearInterval(timer); timer = null; $('#tl-play').text('Play'); }
    $('#tl-next').on('click', function () { stop(); if (i < snaps.length - 1) { i++; render(); } });
    $('#tl-prev').on('click', function () { stop(); if (i > 0) { i--; render(); } });
    $('#tl-reset').on('click', function () { stop(); i = 0; render(); });
    $('#tl-play').on('click', function () {
      if (timer) { stop(); return; }
      if (i >= snaps.length - 1) i = 0;
      $(this).text('Pause');
      timer = setInterval(function () { if (i < snaps.length - 1) { i++; render(); } else stop(); }, 1500);
    });
    render();
  })();

  // ================================================================== 3. history timeline
  (function () {
    var EV = [
      { y: '1943', t: 'dl', h: 'The artificial neuron', x: 'McCulloch and Pitts publish the first mathematical model of a neuron: inputs, a threshold, an output. The idea that brain-like units could compute.' },
      { y: '1958', t: 'dl', h: 'The Perceptron', x: 'Frank Rosenblatt builds the perceptron, the first neural network that learns its weights from examples. It can only separate data with a straight line.' },
      { y: '1969', t: 'dl', h: 'Limits and the first AI winter', x: 'Minsky and Papert show that a single-layer perceptron cannot learn XOR. Funding and interest in neural networks collapse for years.' },
      { y: '1986', t: 'dl', h: 'Backpropagation popularised', x: 'Rumelhart, Hinton and Williams show that multi-layer networks can be trained by passing errors backwards with the chain rule. This is still how every network is trained, including in PyTorch.' },
      { y: '1989', t: 'dl', h: 'Convolutional networks (LeNet)', x: 'Yann LeCun applies convolutional networks to handwritten digits (LeNet-5 follows in 1998). Banks use them to read cheques. The blueprint for modern computer vision.' },
      { y: '1997', t: 'dl', h: 'LSTM', x: 'Hochreiter and Schmidhuber introduce Long Short-Term Memory, a cell with gates that can remember information over long sequences, solving the vanishing-gradient problem for text and speech.' },
      { y: '2002', t: 'fw', h: 'Torch', x: 'Torch, a scientific computing library written in C and driven from Lua, appears from the IDIAP research institute. It later becomes Torch7 (2011). PyTorch inherits its C tensor libraries and its name.' },
      { y: '2006', t: 'dl', h: 'Deep belief networks', x: 'Geoffrey Hinton and colleagues show that deep networks can be trained layer by layer. The term "deep learning" takes off.' },
      { y: '2007', t: 'fw', h: 'Theano', x: 'The Montreal lab of Yoshua Bengio releases Theano: define a symbolic expression, get automatic differentiation and GPU code. The first widely used deep learning framework. Development stopped in 2017.' },
      { y: '2012', t: 'dl', h: 'AlexNet wins ImageNet', x: 'A deep CNN trained on two GPUs cuts the ImageNet image-recognition error dramatically, far ahead of classic methods. The deep learning boom begins: big data + GPUs + deep networks.' },
      { y: '2013', t: 'fw', h: 'Caffe', x: 'Berkeley’s Caffe makes CNNs easy to run, but models are described in config files and the code is hard to customise.' },
      { y: '2014', t: 'dl', h: 'GANs, Adam, attention', x: 'Goodfellow’s GANs generate realistic images; the Adam optimizer becomes the default; Bahdanau introduces attention for machine translation, the seed of the transformer.' },
      { y: '2015', t: 'fw', h: 'TensorFlow, Keras and Chainer', x: 'Google open-sources TensorFlow (static graphs: define everything first, then run it in a session). Keras offers a friendly API. Chainer pioneers "define-by-run": the graph is built as the code executes.' },
      { y: '2015', t: 'dl', h: 'ResNet and BatchNorm', x: 'Residual connections let networks go 100+ layers deep; Batch Normalization makes training faster and more stable. Both are everywhere today.' },
      { y: '2016', t: 'fw', h: 'PyTorch project starts at Facebook AI Research', x: 'A small team (Adam Paszke, Sam Gross, Soumith Chintala, Gregory Chanan and others) builds a Python-first framework combining Torch’s fast tensor core with Chainer-style dynamic graphs and automatic differentiation.' },
      { y: '2016', t: 'dl', h: 'AlphaGo', x: 'DeepMind’s AlphaGo, combining deep networks and reinforcement learning, beats world champion Lee Sedol at Go.' },
      { y: '2017', t: 'fw', h: 'PyTorch released (January)', x: 'PyTorch goes public. Its selling points: it feels like normal Python, you can debug with print and a debugger, and graphs are dynamic, so loops and if-statements just work. Researchers adopt it quickly.' },
      { y: '2017', t: 'dl', h: 'The Transformer', x: '"Attention Is All You Need" replaces recurrence with self-attention. Training parallelises on GPUs and scales; nearly all modern language, vision and audio models descend from it.' },
      { y: '2018', t: 'dl', h: 'BERT and GPT', x: 'Pre-train a big transformer on unlabelled text, then fine-tune it for your task. The pre-train-then-adapt recipe becomes standard.' },
      { y: '2018', t: 'fw', h: 'PyTorch 1.0 (December)', x: 'Adds TorchScript to run models without Python, ONNX export, a C++ frontend, and merges with Caffe2 for production use. PyTorch becomes both a research and a production tool.' },
      { y: '2019', t: 'fw', h: 'PyTorch leads in research', x: 'Most new papers at top conferences use PyTorch. Hugging Face Transformers (built on PyTorch) and PyTorch Lightning appear and grow into the main ecosystem.' },
      { y: '2020', t: 'dl', h: 'GPT-3, ViT, diffusion', x: 'GPT-3 (175 billion parameters) shows few-shot learning from prompts; the Vision Transformer applies transformers to images; denoising diffusion models start to rival GANs. AlphaFold 2 predicts protein structures.' },
      { y: '2020', t: 'fw', h: 'Mixed precision and distributed training', x: 'PyTorch 1.6 adds built-in automatic mixed precision (torch.cuda.amp) and distributed training matures, making multi-GPU training routine.' },
      { y: '2022', t: 'dl', h: 'Stable Diffusion and ChatGPT', x: 'Open image generation (Stable Diffusion) and ChatGPT bring generative AI to everyone. Large models become a mainstream product category.' },
      { y: '2022', t: 'fw', h: 'PyTorch Foundation', x: 'Governance moves from Meta to the PyTorch Foundation under the Linux Foundation, with AMD, AWS, Google, Meta, Microsoft and NVIDIA as founding members.' },
      { y: '2023', t: 'fw', h: 'PyTorch 2.0 and torch.compile', x: 'One line, model = torch.compile(model), captures your code (TorchDynamo) and compiles fast fused kernels (TorchInductor, using Triton on GPUs). Same eager-feeling API, much better speed.' },
      { y: '2023', t: 'dl', h: 'Open LLMs (LLaMA) and efficient fine-tuning', x: 'Open-weight language models spread. LoRA and quantisation let people fine-tune huge models on a single GPU.' },
      { y: '2024', t: 'fw', h: 'LLM-era PyTorch', x: 'Fused FlashAttention in scaled_dot_product_attention, torch.export, ExecuTorch for phones and edge devices, FSDP for sharding huge models, and torchtune for fine-tuning. Today the dominant framework for training large models.' },
      { y: '2025+', t: 'dl', h: 'Multimodal, reasoning and agents', x: 'Models handle text, images, audio and video together, use extra "thinking" computation at inference, and call tools as agents. Smaller, cheaper models keep getting stronger.' }
    ];
    var idx = 0, filter = 'all', timer = null, shown = [];
    function visible() { return EV.filter(function (e) { return filter === 'all' || e.t === filter; }); }
    function build() {
      shown = visible();
      var $tr = $('#tl-track').empty();
      shown.forEach(function (e, k) {
        $('<button type="button" class="tl-dot">').addClass(e.t).attr('data-k', k).append($('<b>').text(e.y), $('<br>'), document.createTextNode(e.h.length > 22 ? e.h.slice(0, 20) + '…' : e.h)).appendTo($tr);
      });
      idx = Math.min(idx, shown.length - 1); select(idx);
    }
    function select(k) {
      idx = k; var e = shown[k];
      $('#tl-track .tl-dot').removeClass('active').eq(k).addClass('active');
      var el = $('#tl-track .tl-dot').get(k), tr = document.getElementById('tl-track');   // scroll the track only, never the page
      if (el) tr.scrollLeft = el.offsetLeft - tr.offsetLeft - tr.clientWidth / 2 + el.offsetWidth / 2;
      $('#tl-card').empty().append($('<h4>').text(e.y + ' – ' + e.h), $('<p>').text(e.x),
        $('<span class="muted">').text(e.t === 'dl' ? 'Deep learning milestone' : 'Framework / PyTorch milestone'));
      $('#tlp-prev').prop('disabled', k <= 0); $('#tlp-next').prop('disabled', k >= shown.length - 1);
    }
    function stop() { clearInterval(timer); timer = null; $('#tlp-play').text('Play'); }
    $('#tl-track').on('click', '.tl-dot', function () { stop(); select(+$(this).data('k')); });
    $('#tlp-next').on('click', function () { stop(); if (idx < shown.length - 1) select(idx + 1); });
    $('#tlp-prev').on('click', function () { stop(); if (idx > 0) select(idx - 1); });
    $('#tlp-play').on('click', function () {
      if (timer) { stop(); return; }
      if (idx >= shown.length - 1) select(0);
      $(this).text('Pause');
      timer = setInterval(function () { if (idx < shown.length - 1) select(idx + 1); else stop(); }, 3200);
    });
    $('#tl-filter').on('click', 'button', function () {
      stop(); filter = $(this).data('f'); idx = 0;
      $('#tl-filter button').removeClass('active'); $(this).addClass('active'); build();
    });
    build();
  })();
});
