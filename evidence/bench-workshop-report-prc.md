=== workshop-pipeline 性能基线 · 2026-10-18T09:10:34.652Z ===
env: node v25.8.1 darwin-x64 · Intel(R) Core(TM) i7-14700KF 28核 64GB · three 0.180.0 · tsx 4.23.15 · commit cc6433d
cmd: node --import tsx --expose-gc scripts/bench-workshop.mts --compare evidence/bench-workshop-prb.json --out evidence/bench-workshop-prc.json --report evidence/bench-workshop-report-prc.md
params: seed 1 warmup 2 reps 7 gc available
口径: 全部为 µs · 阶段帧级分摊=compile(compileMotion·每rep一次)/sample(frameAtCompiled)/solve(solveEffectiveFrame+analyzePose)/render(未测量) · captureSerialize=残差+stringify
    残差可为负（两段测量回路的中位噪声）；captureSerialize 含 stringify，四桶份额不必合计 100%

=== default-5k @40fps · 38 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=266):
    frameAtCompiled      med 5.5µs p95 16.9µs
    solveEffectiveFrame  med 85.8µs p95 132.1µs
    analyzePose          med 30.7µs p95 49.1µs
    buildModel           med 10.5µs p95 31.6µs  (compat 交叉校验 n=266)
    frameFromModel       med 5.8µs p95 16.9µs  (compat 交叉校验 n=266)
    frameAt              med 14.9µs p95 42.6µs  (compat 交叉校验 n=266)
    samplePose           med 14.6µs p95 43.6µs  (compat 交叉校验 n=266)
  每rep (n=7):
    compileMotion        med 48.9µs p95 111.5µs
    solveWorkshop        med 6.97ms p95 9.10ms
    stringify            med 766.2µs p95 1.50ms
    probeFrames          med 5.79ms p95 9.14ms
    analyzeProbeFrames   med 668.3µs p95 739.0µs
    probeDocument        med 5.79ms p95 9.54ms
  roll-up (占 solveWorkshop median 6.97ms 的份额):
    compile          = compileMotion（每rep一次）     med 48.9µs p95 111.5µs  0.7021%
    sample           = frameAtCompiled                med 230.6µs p95 528.8µs  3.308%
    solve            = solveEffectiveFrame+analyzePose med 4.59ms p95 5.98ms  65.79%
    captureSerialize = 残差+stringify                 med 2.87ms p95 3.60ms  41.19%  (残差 2.10ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 5452 samples/s · 包体 133.2KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 91.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 6.03ms/刷新 — 估算非实测
  内存: churn med 13.7MB p95 14.4MB /rep · post-gc heap 19→19→19→19→19→19→19MB

=== default-5k @60fps · 54 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=378):
    frameAtCompiled      med 7.2µs p95 16.9µs
    solveEffectiveFrame  med 75.3µs p95 86.6µs
    analyzePose          med 28.4µs p95 33.4µs
    buildModel           med 12.5µs p95 14.6µs  (compat 交叉校验 n=378)
    frameFromModel       med 6.6µs p95 17.2µs  (compat 交叉校验 n=378)
    frameAt              med 17.6µs p95 31.9µs  (compat 交叉校验 n=378)
    samplePose           med 19.9µs p95 30.1µs  (compat 交叉校验 n=378)
  每rep (n=7):
    compileMotion        med 35.9µs p95 65.3µs
    solveWorkshop        med 9.82ms p95 9.97ms
    stringify            med 1.04ms p95 1.15ms
    probeFrames          med 8.00ms p95 8.35ms
    analyzeProbeFrames   med 881.3µs p95 948.3µs
    probeDocument        med 8.29ms p95 8.76ms
  roll-up (占 solveWorkshop median 9.82ms 的份额):
    compile          = compileMotion（每rep一次）     med 35.9µs p95 65.3µs  0.365%
    sample           = frameAtCompiled                med 547.4µs p95 885.9µs  5.573%
    solve            = solveEffectiveFrame+analyzePose med 5.77ms p95 5.92ms  58.72%
    captureSerialize = 残差+stringify                 med 4.51ms p95 4.62ms  45.96%  (残差 3.47ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 5497 samples/s · 包体 196.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 82.5µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.45ms/刷新 — 估算非实测
  内存: churn med 9.1MB p95 10.0MB /rep · post-gc heap 19→19→19→19→19→19→19MB

=== default-5k @240fps · 198 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=1386):
    frameAtCompiled      med 5.2µs p95 10.9µs
    solveEffectiveFrame  med 71.0µs p95 98.8µs
    analyzePose          med 26.0µs p95 38.4µs
    buildModel           med 12.8µs p95 27.1µs  (compat 交叉校验 n=462)
    frameFromModel       med 5.3µs p95 11.6µs  (compat 交叉校验 n=462)
    frameAt              med 16.7µs p95 33.4µs  (compat 交叉校验 n=462)
    samplePose           med 16.3µs p95 34.0µs  (compat 交叉校验 n=462)
  每rep (n=7):
    compileMotion        med 36.5µs p95 49.3µs
    solveWorkshop        med 24.46ms p95 25.39ms
    stringify            med 1.49ms p95 4.58ms
    probeFrames          med 25.55ms p95 26.29ms
    analyzeProbeFrames   med 2.87ms p95 3.25ms
    probeDocument        med 27.77ms p95 36.02ms
  roll-up (占 solveWorkshop median 24.46ms 的份额):
    compile          = compileMotion（每rep一次）     med 36.5µs p95 49.3µs  0.1492%
    sample           = frameAtCompiled                med 1.04ms p95 1.63ms  4.236%
    solve            = solveEffectiveFrame+analyzePose med 19.85ms p95 23.83ms  81.16%
    captureSerialize = 残差+stringify                 med 5.02ms p95 8.12ms  20.54%  (残差 3.54ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8095 samples/s · 包体 760.6KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.02ms/刷新 — 估算非实测
  内存: churn med 35.6MB p95 64.1MB /rep · post-gc heap 22→22→23→22→22→22→22MB

=== forehand-49k @40fps · 258 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=1806):
    frameAtCompiled      med 5.4µs p95 6.6µs
    solveEffectiveFrame  med 70.0µs p95 85.0µs
    analyzePose          med 24.2µs p95 27.2µs
    buildModel           med 54.5µs p95 109.0µs  (compat 交叉校验 n=455)
    frameFromModel       med 5.5µs p95 6.4µs  (compat 交叉校验 n=455)
    frameAt              med 57.9µs p95 111.3µs  (compat 交叉校验 n=455)
    samplePose           med 57.0µs p95 107.0µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 208.4µs p95 344.2µs
    solveWorkshop        med 30.45ms p95 31.11ms
    stringify            med 4.59ms p95 5.01ms
    probeFrames          med 27.51ms p95 27.72ms
    analyzeProbeFrames   med 3.43ms p95 3.73ms
    probeDocument        med 30.18ms p95 30.56ms
  roll-up (占 solveWorkshop median 30.45ms 的份额):
    compile          = compileMotion（每rep一次）     med 208.4µs p95 344.2µs  0.6844%
    sample           = frameAtCompiled                med 1.42ms p95 1.48ms  4.67%
    solve            = solveEffectiveFrame+analyzePose med 25.24ms p95 26.09ms  82.9%
    captureSerialize = 残差+stringify                 med 8.17ms p95 8.58ms  26.84%  (残差 3.58ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8473 samples/s · 包体 823KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 75.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.98ms/刷新 — 估算非实测
  内存: churn med 21.6MB p95 22.3MB /rep · post-gc heap 22→23→22→22→22→22→22MB

=== forehand-49k @60fps · 362 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=2534):
    frameAtCompiled      med 5.9µs p95 17.2µs
    solveEffectiveFrame  med 70.2µs p95 86.3µs
    analyzePose          med 24.1µs p95 27.7µs
    buildModel           med 56.7µs p95 104.1µs  (compat 交叉校验 n=511)
    frameFromModel       med 6.6µs p95 24.1µs  (compat 交叉校验 n=511)
    frameAt              med 60.6µs p95 115.4µs  (compat 交叉校验 n=511)
    samplePose           med 59.7µs p95 110.8µs  (compat 交叉校验 n=511)
  每rep (n=7):
    compileMotion        med 223.4µs p95 396.2µs
    solveWorkshop        med 42.21ms p95 43.42ms
    stringify            med 2.41ms p95 2.53ms
    probeFrames          med 39.79ms p95 40.68ms
    analyzeProbeFrames   med 5.36ms p95 5.52ms
    probeDocument        med 44.28ms p95 44.79ms
  roll-up (占 solveWorkshop median 42.21ms 的份额):
    compile          = compileMotion（每rep一次）     med 223.4µs p95 396.2µs  0.5292%
    sample           = frameAtCompiled                med 2.23ms p95 6.60ms  5.288%
    solve            = solveEffectiveFrame+analyzePose med 35.58ms p95 38.39ms  84.29%
    captureSerialize = 残差+stringify                 med 6.58ms p95 6.70ms  15.6%  (残差 4.18ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8576 samples/s · 包体 1232KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.02ms/刷新 — 估算非实测
  内存: churn med 23.5MB p95 24.3MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== forehand-49k @240fps · 1298 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=9086):
    frameAtCompiled      med 5.1µs p95 6.1µs
    solveEffectiveFrame  med 68.3µs p95 78.0µs
    analyzePose          med 23.6µs p95 26.1µs
    buildModel           med 54.6µs p95 105.9µs  (compat 交叉校验 n=455)
    frameFromModel       med 5.7µs p95 7.1µs  (compat 交叉校验 n=455)
    frameAt              med 56.6µs p95 107.5µs  (compat 交叉校验 n=455)
    samplePose           med 54.8µs p95 105.9µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 209.7µs p95 288.4µs
    solveWorkshop        med 148.60ms p95 150.70ms
    stringify            med 10.08ms p95 10.78ms
    probeFrames          med 154.40ms p95 155.20ms
    analyzeProbeFrames   med 14.67ms p95 18.86ms
    probeDocument        med 166.70ms p95 171.90ms
  roll-up (占 solveWorkshop median 148.60ms 的份额):
    compile          = compileMotion（每rep一次）     med 209.7µs p95 288.4µs  0.1411%
    sample           = frameAtCompiled                med 6.87ms p95 7.11ms  4.624%
    solve            = solveEffectiveFrame+analyzePose med 122.30ms p95 122.80ms  82.32%
    captureSerialize = 残差+stringify                 med 29.27ms p95 29.97ms  19.7%  (残差 19.19ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8737 samples/s · 包体 4901KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 73.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.84ms/刷新 — 估算非实测
  内存: churn med 90.6MB p95 92.4MB /rep · post-gc heap 40→40→40→40→40→40→40MB

=== k5-d2 @40fps · 86 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=602):
    frameAtCompiled      med 5.5µs p95 7.1µs
    solveEffectiveFrame  med 77.1µs p95 86.9µs
    analyzePose          med 24.9µs p95 28.2µs
    buildModel           med 8.3µs p95 12.7µs  (compat 交叉校验 n=602)
    frameFromModel       med 5.6µs p95 6.9µs  (compat 交叉校验 n=602)
    frameAt              med 13.3µs p95 17.4µs  (compat 交叉校验 n=602)
    samplePose           med 12.8µs p95 17.0µs  (compat 交叉校验 n=602)
  每rep (n=7):
    compileMotion        med 28.9µs p95 44.7µs
    solveWorkshop        med 13.56ms p95 14.70ms
    stringify            med 1.78ms p95 1.95ms
    probeFrames          med 11.47ms p95 12.42ms
    analyzeProbeFrames   med 1.52ms p95 1.55ms
    probeDocument        med 13.30ms p95 14.02ms
  roll-up (占 solveWorkshop median 13.56ms 的份额):
    compile          = compileMotion（每rep一次）     med 28.9µs p95 44.7µs  0.2128%
    sample           = frameAtCompiled                med 477.6µs p95 500.7µs  3.522%
    solve            = solveEffectiveFrame+analyzePose med 8.97ms p95 9.40ms  66.14%
    captureSerialize = 残差+stringify                 med 5.86ms p95 6.04ms  43.24%  (残差 4.08ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 6342 samples/s · 包体 309.8KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 82.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.45ms/刷新 — 估算非实测
  内存: churn med 3.3MB p95 64.9MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k5-d2 @60fps · 126 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=882):
    frameAtCompiled      med 5.4µs p95 12.3µs
    solveEffectiveFrame  med 73.2µs p95 78.4µs
    analyzePose          med 24.4µs p95 26.1µs
    buildModel           med 11.0µs p95 12.3µs  (compat 交叉校验 n=882)
    frameFromModel       med 5.7µs p95 12.6µs  (compat 交叉校验 n=882)
    frameAt              med 15.3µs p95 23.1µs  (compat 交叉校验 n=882)
    samplePose           med 14.9µs p95 22.8µs  (compat 交叉校验 n=882)
  每rep (n=7):
    compileMotion        med 32.2µs p95 50.5µs
    solveWorkshop        med 17.82ms p95 18.17ms
    stringify            med 2.39ms p95 2.94ms
    probeFrames          med 15.84ms p95 16.62ms
    analyzeProbeFrames   med 2.14ms p95 2.20ms
    probeDocument        med 18.13ms p95 18.47ms
  roll-up (占 solveWorkshop median 17.82ms 的份额):
    compile          = compileMotion（每rep一次）     med 32.2µs p95 50.5µs  0.1809%
    sample           = frameAtCompiled                med 662.0µs p95 1.55ms  3.715%
    solve            = solveEffectiveFrame+analyzePose med 12.48ms p95 12.79ms  70.03%
    captureSerialize = 残差+stringify                 med 7.03ms p95 7.59ms  39.47%  (残差 4.64ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7071 samples/s · 包体 461.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 78.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.19ms/刷新 — 估算非实测
  内存: churn med 22.2MB p95 22.9MB /rep · post-gc heap 21→21→21→21→21→21→21MB

=== k5-d2 @240fps · 486 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=3402):
    frameAtCompiled      med 4.8µs p95 5.6µs
    solveEffectiveFrame  med 70.6µs p95 74.6µs
    analyzePose          med 23.7µs p95 25.3µs
    buildModel           med 14.5µs p95 18.6µs  (compat 交叉校验 n=490)
    frameFromModel       med 4.9µs p95 5.8µs  (compat 交叉校验 n=490)
    frameAt              med 17.0µs p95 19.5µs  (compat 交叉校验 n=490)
    samplePose           med 16.6µs p95 19.0µs  (compat 交叉校验 n=490)
  每rep (n=7):
    compileMotion        med 35.2µs p95 58.2µs
    solveWorkshop        med 57.14ms p95 58.55ms
    stringify            med 8.99ms p95 9.35ms
    probeFrames          med 60.65ms p95 61.12ms
    analyzeProbeFrames   med 7.14ms p95 7.55ms
    probeDocument        med 65.61ms p95 67.26ms
  roll-up (占 solveWorkshop median 57.14ms 的份额):
    compile          = compileMotion（每rep一次）     med 35.2µs p95 58.2µs  0.06166%
    sample           = frameAtCompiled                med 2.36ms p95 2.40ms  4.138%
    solve            = solveEffectiveFrame+analyzePose med 46.49ms p95 47.17ms  81.37%
    captureSerialize = 残差+stringify                 med 17.24ms p95 17.60ms  30.18%  (残差 8.25ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8506 samples/s · 包体 1823KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 75.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.98ms/刷新 — 估算非实测
  内存: churn med 53.5MB p95 61.1MB /rep · post-gc heap 27→27→27→27→27→27→27MB

=== k5-d5 @40fps · 206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=1442):
    frameAtCompiled      med 5.0µs p95 6.0µs
    solveEffectiveFrame  med 71.3µs p95 76.3µs
    analyzePose          med 23.9µs p95 25.9µs
    buildModel           med 8.0µs p95 9.4µs  (compat 交叉校验 n=483)
    frameFromModel       med 5.1µs p95 6.5µs  (compat 交叉校验 n=483)
    frameAt              med 12.3µs p95 13.6µs  (compat 交叉校验 n=483)
    samplePose           med 12.1µs p95 13.6µs  (compat 交叉校验 n=483)
  每rep (n=7):
    compileMotion        med 30.1µs p95 37.5µs
    solveWorkshop        med 28.73ms p95 29.83ms
    stringify            med 3.96ms p95 4.16ms
    probeFrames          med 28.06ms p95 29.52ms
    analyzeProbeFrames   med 3.22ms p95 3.32ms
    probeDocument        med 30.58ms p95 31.37ms
  roll-up (占 solveWorkshop median 28.73ms 的份额):
    compile          = compileMotion（每rep一次）     med 30.1µs p95 37.5µs  0.1046%
    sample           = frameAtCompiled                med 1.07ms p95 1.10ms  3.731%
    solve            = solveEffectiveFrame+analyzePose med 19.97ms p95 20.66ms  69.51%
    captureSerialize = 残差+stringify                 med 11.62ms p95 11.82ms  40.44%  (残差 7.66ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7170 samples/s · 包体 759.5KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.04ms/刷新 — 估算非实测
  内存: churn med 30.2MB p95 32.1MB /rep · post-gc heap 22→22→22→22→22→22→22MB

=== k5-d5 @60fps · 306 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=2142):
    frameAtCompiled      med 5.7µs p95 12.2µs
    solveEffectiveFrame  med 71.1µs p95 75.4µs
    analyzePose          med 24.2µs p95 25.9µs
    buildModel           med 8.6µs p95 10.8µs  (compat 交叉校验 n=539)
    frameFromModel       med 5.8µs p95 12.4µs  (compat 交叉校验 n=539)
    frameAt              med 13.0µs p95 20.6µs  (compat 交叉校验 n=539)
    samplePose           med 12.7µs p95 20.4µs  (compat 交叉校验 n=539)
  每rep (n=7):
    compileMotion        med 29.3µs p95 49.4µs
    solveWorkshop        med 35.88ms p95 36.56ms
    stringify            med 5.73ms p95 6.05ms
    probeFrames          med 38.76ms p95 39.53ms
    analyzeProbeFrames   med 4.36ms p95 5.22ms
    probeDocument        med 42.26ms p95 43.33ms
  roll-up (占 solveWorkshop median 35.88ms 的份额):
    compile          = compileMotion（每rep一次）     med 29.3µs p95 49.4µs  0.0816%
    sample           = frameAtCompiled                med 1.68ms p95 3.68ms  4.668%
    solve            = solveEffectiveFrame+analyzePose med 29.47ms p95 30.40ms  82.13%
    captureSerialize = 残差+stringify                 med 10.43ms p95 10.76ms  29.08%  (残差 4.71ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8528 samples/s · 包体 1138KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.8µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.07ms/刷新 — 估算非实测
  内存: churn med 10.7MB p95 69.8MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k5-d5 @240fps · 1206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=8442):
    frameAtCompiled      med 4.9µs p95 5.5µs
    solveEffectiveFrame  med 70.0µs p95 73.5µs
    analyzePose          med 23.6µs p95 25.0µs
    buildModel           med 14.8µs p95 20.1µs  (compat 交叉校验 n=469)
    frameFromModel       med 5.1µs p95 5.8µs  (compat 交叉校验 n=469)
    frameAt              med 16.9µs p95 18.9µs  (compat 交叉校验 n=469)
    samplePose           med 16.4µs p95 18.3µs  (compat 交叉校验 n=469)
  每rep (n=7):
    compileMotion        med 36.6µs p95 54.6µs
    solveWorkshop        med 139.20ms p95 141.00ms
    stringify            med 23.68ms p95 26.01ms
    probeFrames          med 150.50ms p95 151.20ms
    analyzeProbeFrames   med 13.52ms p95 17.38ms
    probeDocument        med 160.40ms p95 166.00ms
  roll-up (占 solveWorkshop median 139.20ms 的份额):
    compile          = compileMotion（每rep一次）     med 36.6µs p95 54.6µs  0.02627%
    sample           = frameAtCompiled                med 5.82ms p95 5.87ms  4.177%
    solve            = solveEffectiveFrame+analyzePose med 114.20ms p95 114.40ms  82.01%
    captureSerialize = 残差+stringify                 med 42.87ms p95 45.20ms  30.79%  (残差 19.19ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8661 samples/s · 包体 4526KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 74.8µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.94ms/刷新 — 估算非实测
  内存: churn med 58.7MB p95 69.4MB /rep · post-gc heap 46→38→38→46→38→38→38MB

=== k20-d2 @40fps · 101 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=707):
    frameAtCompiled      med 6.0µs p95 12.4µs
    solveEffectiveFrame  med 75.3µs p95 84.6µs
    analyzePose          med 25.0µs p95 26.8µs
    buildModel           med 22.9µs p95 27.0µs  (compat 交叉校验 n=707)
    frameFromModel       med 5.9µs p95 12.7µs  (compat 交叉校验 n=707)
    frameAt              med 27.6µs p95 37.9µs  (compat 交叉校验 n=707)
    samplePose           med 27.1µs p95 36.8µs  (compat 交叉校验 n=707)
  每rep (n=7):
    compileMotion        med 88.2µs p95 115.0µs
    solveWorkshop        med 16.46ms p95 17.01ms
    stringify            med 1.57ms p95 2.47ms
    probeFrames          med 11.78ms p95 12.76ms
    analyzeProbeFrames   med 1.60ms p95 1.63ms
    probeDocument        med 13.40ms p95 17.50ms
  roll-up (占 solveWorkshop median 16.46ms 的份额):
    compile          = compileMotion（每rep一次）     med 88.2µs p95 115.0µs  0.5357%
    sample           = frameAtCompiled                med 602.9µs p95 1.16ms  3.662%
    solve            = solveEffectiveFrame+analyzePose med 10.22ms p95 10.91ms  62.08%
    captureSerialize = 残差+stringify                 med 7.12ms p95 8.02ms  43.28%  (残差 5.55ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 6135 samples/s · 包体 311.9KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 81.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.37ms/刷新 — 估算非实测
  内存: churn med 8.3MB p95 60.1MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k20-d2 @60fps · 141 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=987):
    frameAtCompiled      med 7.6µs p95 13.8µs
    solveEffectiveFrame  med 73.6µs p95 94.6µs
    analyzePose          med 24.8µs p95 29.8µs
    buildModel           med 27.1µs p95 52.6µs  (compat 交叉校验 n=497)
    frameFromModel       med 7.6µs p95 13.8µs  (compat 交叉校验 n=497)
    frameAt              med 31.6µs p95 64.1µs  (compat 交叉校验 n=497)
    samplePose           med 30.8µs p95 61.8µs  (compat 交叉校验 n=497)
  每rep (n=7):
    compileMotion        med 90.6µs p95 187.8µs
    solveWorkshop        med 20.90ms p95 24.12ms
    stringify            med 2.58ms p95 3.59ms
    probeFrames          med 18.01ms p95 19.18ms
    analyzeProbeFrames   med 2.51ms p95 2.56ms
    probeDocument        med 19.09ms p95 20.02ms
  roll-up (占 solveWorkshop median 20.90ms 的份额):
    compile          = compileMotion（每rep一次）     med 90.6µs p95 187.8µs  0.4336%
    sample           = frameAtCompiled                med 1.02ms p95 2.08ms  4.871%
    solve            = solveEffectiveFrame+analyzePose med 14.42ms p95 14.93ms  69%
    captureSerialize = 残差+stringify                 med 7.96ms p95 8.96ms  38.06%  (残差 5.37ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 6747 samples/s · 包体 464KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 81.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.36ms/刷新 — 估算非实测
  内存: churn med 35.9MB p95 41.0MB /rep · post-gc heap 22→21→21→21→21→21→22MB

=== k20-d2 @240fps · 501 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=3507):
    frameAtCompiled      med 5.4µs p95 7.2µs
    solveEffectiveFrame  med 70.5µs p95 82.4µs
    analyzePose          med 23.8µs p95 27.8µs
    buildModel           med 27.7µs p95 55.5µs  (compat 交叉校验 n=504)
    frameFromModel       med 5.7µs p95 7.9µs  (compat 交叉校验 n=504)
    frameAt              med 30.4µs p95 55.5µs  (compat 交叉校验 n=504)
    samplePose           med 29.8µs p95 54.8µs  (compat 交叉校验 n=504)
  每rep (n=7):
    compileMotion        med 93.6µs p95 155.9µs
    solveWorkshop        med 64.48ms p95 67.27ms
    stringify            med 9.41ms p95 9.90ms
    probeFrames          med 63.22ms p95 65.97ms
    analyzeProbeFrames   med 7.34ms p95 8.17ms
    probeDocument        med 68.18ms p95 71.16ms
  roll-up (占 solveWorkshop median 64.48ms 的份额):
    compile          = compileMotion（每rep一次）     med 93.6µs p95 155.9µs  0.1451%
    sample           = frameAtCompiled                med 2.87ms p95 3.03ms  4.454%
    solve            = solveEffectiveFrame+analyzePose med 48.52ms p95 50.71ms  75.25%
    captureSerialize = 残差+stringify                 med 22.41ms p95 22.90ms  34.75%  (残差 13.00ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7770 samples/s · 包体 1828KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.01ms/刷新 — 估算非实测
  内存: churn med 32.3MB p95 63.7MB /rep · post-gc heap 27→27→27→27→27→27→30MB

=== k20-d5 @40fps · 221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=1547):
    frameAtCompiled      med 5.8µs p95 7.3µs
    solveEffectiveFrame  med 71.5µs p95 78.0µs
    analyzePose          med 23.9µs p95 26.0µs
    buildModel           med 24.7µs p95 41.3µs  (compat 交叉校验 n=518)
    frameFromModel       med 6.1µs p95 7.5µs  (compat 交叉校验 n=518)
    frameAt              med 29.1µs p95 44.3µs  (compat 交叉校验 n=518)
    samplePose           med 28.4µs p95 43.4µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 91.7µs p95 130.4µs
    solveWorkshop        med 31.23ms p95 31.63ms
    stringify            med 3.98ms p95 4.29ms
    probeFrames          med 28.44ms p95 28.74ms
    analyzeProbeFrames   med 3.57ms p95 3.70ms
    probeDocument        med 30.15ms p95 31.60ms
  roll-up (占 solveWorkshop median 31.23ms 的份额):
    compile          = compileMotion（每rep一次）     med 91.7µs p95 130.4µs  0.2936%
    sample           = frameAtCompiled                med 1.34ms p95 1.42ms  4.295%
    solve            = solveEffectiveFrame+analyzePose med 21.34ms p95 22.35ms  68.34%
    captureSerialize = 残差+stringify                 med 12.43ms p95 12.74ms  39.81%  (残差 8.45ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7077 samples/s · 包体 765.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 77.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.11ms/刷新 — 估算非实测
  内存: churn med 31.6MB p95 35.1MB /rep · post-gc heap 22→22→22→22→22→22→22MB

=== k20-d5 @60fps · 321 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=2247):
    frameAtCompiled      med 7.2µs p95 13.6µs
    solveEffectiveFrame  med 70.8µs p95 79.3µs
    analyzePose          med 24.1µs p95 26.8µs
    buildModel           med 28.1µs p95 56.0µs  (compat 交叉校验 n=455)
    frameFromModel       med 8.1µs p95 13.7µs  (compat 交叉校验 n=455)
    frameAt              med 32.0µs p95 61.8µs  (compat 交叉校验 n=455)
    samplePose           med 30.9µs p95 61.1µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 111.3µs p95 157.9µs
    solveWorkshop        med 43.55ms p95 45.19ms
    stringify            med 6.21ms p95 7.08ms
    probeFrames          med 41.14ms p95 42.80ms
    analyzeProbeFrames   med 4.86ms p95 5.14ms
    probeDocument        med 44.02ms p95 47.72ms
  roll-up (占 solveWorkshop median 43.55ms 的份额):
    compile          = compileMotion（每rep一次）     med 111.3µs p95 157.9µs  0.2556%
    sample           = frameAtCompiled                med 2.52ms p95 4.16ms  5.775%
    solve            = solveEffectiveFrame+analyzePose med 31.14ms p95 31.54ms  71.51%
    captureSerialize = 残差+stringify                 med 15.99ms p95 16.86ms  36.72%  (残差 9.78ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7371 samples/s · 包体 1146KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 78.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.15ms/刷新 — 估算非实测
  内存: churn med 32.8MB p95 42.0MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5 @240fps · 1221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=8547):
    frameAtCompiled      med 5.1µs p95 6.4µs
    solveEffectiveFrame  med 68.8µs p95 74.4µs
    analyzePose          med 23.4µs p95 25.4µs
    buildModel           med 26.4µs p95 39.0µs  (compat 交叉校验 n=455)
    frameFromModel       med 5.5µs p95 6.7µs  (compat 交叉校验 n=455)
    frameAt              med 27.9µs p95 38.0µs  (compat 交叉校验 n=455)
    samplePose           med 27.2µs p95 37.1µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 92.6µs p95 139.2µs
    solveWorkshop        med 149.50ms p95 155.00ms
    stringify            med 8.41ms p95 23.61ms
    probeFrames          med 149.30ms p95 159.70ms
    analyzeProbeFrames   med 14.05ms p95 18.35ms
    probeDocument        med 161.90ms p95 164.90ms
  roll-up (占 solveWorkshop median 149.50ms 的份额):
    compile          = compileMotion（每rep一次）     med 92.6µs p95 139.2µs  0.06192%
    sample           = frameAtCompiled                med 6.39ms p95 7.08ms  4.277%
    solve            = solveEffectiveFrame+analyzePose med 114.60ms p95 116.00ms  76.65%
    captureSerialize = 残差+stringify                 med 36.84ms p95 52.04ms  24.64%  (残差 28.43ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8166 samples/s · 包体 4556KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 73.9µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.88ms/刷新 — 估算非实测
  内存: churn med 53.6MB p95 85.6MB /rep · post-gc heap 38→38→38→38→38→38→38MB

=== k20-d5-nib @40fps · 221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=1547):
    frameAtCompiled      med 0.9µs p95 1.2µs
    solveEffectiveFrame  med 71.1µs p95 80.7µs
    analyzePose          med 24.3µs p95 28.0µs
    buildModel           med 23.9µs p95 33.8µs  (compat 交叉校验 n=518)
    frameFromModel       med 0.9µs p95 1.5µs  (compat 交叉校验 n=518)
    frameAt              med 22.7µs p95 27.4µs  (compat 交叉校验 n=518)
    samplePose           med 28.9µs p95 41.1µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 88.9µs p95 115.8µs
    solveWorkshop        med 25.93ms p95 28.80ms
    stringify            med 4.04ms p95 4.49ms
    probeFrames          med 25.36ms p95 26.30ms
    analyzeProbeFrames   med 3.36ms p95 3.46ms
    probeDocument        med 28.19ms p95 28.61ms
  roll-up (占 solveWorkshop median 25.93ms 的份额):
    compile          = compileMotion（每rep一次）     med 88.9µs p95 115.8µs  0.3428%
    sample           = frameAtCompiled                med 193.0µs p95 242.7µs  0.7443%
    solve            = solveEffectiveFrame+analyzePose med 21.52ms p95 22.59ms  82.99%
    captureSerialize = 残差+stringify                 med 8.16ms p95 8.61ms  31.49%  (残差 4.13ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8523 samples/s · 包体 763.1KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 72.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.75ms/刷新 — 估算非实测
  内存: churn med 6.7MB p95 11.2MB /rep · post-gc heap 22→22→22→22→22→22→22MB

=== k20-d5-nib @60fps · 321 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=2247):
    frameAtCompiled      med 1.0µs p95 1.3µs
    solveEffectiveFrame  med 70.3µs p95 79.4µs
    analyzePose          med 23.7µs p95 26.8µs
    buildModel           med 27.8µs p95 56.3µs  (compat 交叉校验 n=455)
    frameFromModel       med 1.2µs p95 1.8µs  (compat 交叉校验 n=455)
    frameAt              med 26.0µs p95 49.9µs  (compat 交叉校验 n=455)
    samplePose           med 44.2µs p95 89.2µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 114.3µs p95 163.6µs
    solveWorkshop        med 36.43ms p95 37.15ms
    stringify            med 5.56ms p95 6.47ms
    probeFrames          med 37.35ms p95 37.95ms
    analyzeProbeFrames   med 4.87ms p95 4.95ms
    probeDocument        med 41.28ms p95 42.17ms
  roll-up (占 solveWorkshop median 36.43ms 的份额):
    compile          = compileMotion（每rep一次）     med 114.3µs p95 163.6µs  0.3138%
    sample           = frameAtCompiled                med 337.1µs p95 355.8µs  0.9254%
    solve            = solveEffectiveFrame+analyzePose med 31.11ms p95 31.36ms  85.4%
    captureSerialize = 残差+stringify                 med 10.42ms p95 11.34ms  28.61%  (残差 4.87ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8812 samples/s · 包体 1143KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 71.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.70ms/刷新 — 估算非实测
  内存: churn med 62.7MB p95 65.0MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5-nib @240fps · 1221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=8547):
    frameAtCompiled      med 0.7µs p95 1.0µs
    solveEffectiveFrame  med 68.4µs p95 74.5µs
    analyzePose          med 23.3µs p95 25.5µs
    buildModel           med 26.2µs p95 40.3µs  (compat 交叉校验 n=455)
    frameFromModel       med 0.9µs p95 1.4µs  (compat 交叉校验 n=455)
    frameAt              med 23.4µs p95 32.2µs  (compat 交叉校验 n=455)
    samplePose           med 38.2µs p95 54.4µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 91.0µs p95 150.5µs
    solveWorkshop        med 133.50ms p95 134.50ms
    stringify            med 7.97ms p95 21.31ms
    probeFrames          med 143.60ms p95 144.00ms
    analyzeProbeFrames   med 13.73ms p95 17.42ms
    probeDocument        med 153.50ms p95 154.30ms
  roll-up (占 solveWorkshop median 133.50ms 的份额):
    compile          = compileMotion（每rep一次）     med 91.0µs p95 150.5µs  0.06817%
    sample           = frameAtCompiled                med 956.9µs p95 1.28ms  0.7169%
    solve            = solveEffectiveFrame+analyzePose med 113.10ms p95 115.50ms  84.74%
    captureSerialize = 残差+stringify                 med 27.29ms p95 40.63ms  20.45%  (残差 19.32ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 9148 samples/s · 包体 4543KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 69.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.56ms/刷新 — 估算非实测
  内存: churn med 79.5MB p95 88.1MB /rep · post-gc heap 37→37→37→37→37→37→37MB

=== k100-d2 @40fps · 181 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1267):
    frameAtCompiled      med 6.6µs p95 7.8µs
    solveEffectiveFrame  med 78.0µs p95 91.4µs
    analyzePose          med 25.0µs p95 27.3µs
    buildModel           med 101.3µs p95 114.3µs  (compat 交叉校验 n=637)
    frameFromModel       med 6.8µs p95 8.0µs  (compat 交叉校验 n=637)
    frameAt              med 104.2µs p95 119.0µs  (compat 交叉校验 n=637)
    samplePose           med 102.8µs p95 119.3µs  (compat 交叉校验 n=637)
  每rep (n=7):
    compileMotion        med 404.0µs p95 437.0µs
    solveWorkshop        med 26.19ms p95 27.42ms
    stringify            med 1.69ms p95 2.15ms
    probeFrames          med 12.01ms p95 12.38ms
    analyzeProbeFrames   med 1.82ms p95 2.08ms
    probeDocument        med 13.41ms p95 14.12ms
  roll-up (占 solveWorkshop median 26.19ms 的份额):
    compile          = compileMotion（每rep一次）     med 404.0µs p95 437.0µs  1.543%
    sample           = frameAtCompiled                med 1.23ms p95 1.31ms  4.704%
    solve            = solveEffectiveFrame+analyzePose med 18.64ms p95 19.19ms  71.17%
    captureSerialize = 残差+stringify                 med 7.60ms p95 8.06ms  29.02%  (残差 5.91ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 6911 samples/s · 包体 315.4KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 84.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.58ms/刷新 — 估算非实测
  内存: churn med 20.2MB p95 25.6MB /rep · post-gc heap 20→20→21→20→20→20→20MB

=== k100-d2 @60fps · 221 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1547):
    frameAtCompiled      med 6.7µs p95 13.5µs
    solveEffectiveFrame  med 72.0µs p95 89.9µs
    analyzePose          med 24.0µs p95 27.2µs
    buildModel           med 101.8µs p95 223.5µs  (compat 交叉校验 n=518)
    frameFromModel       med 7.1µs p95 14.4µs  (compat 交叉校验 n=518)
    frameAt              med 104.8µs p95 209.5µs  (compat 交叉校验 n=518)
    samplePose           med 103.6µs p95 218.7µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 407.3µs p95 598.0µs
    solveWorkshop        med 32.63ms p95 32.99ms
    stringify            med 2.40ms p95 2.98ms
    probeFrames          med 17.86ms p95 18.11ms
    analyzeProbeFrames   med 2.49ms p95 2.81ms
    probeDocument        med 19.22ms p95 19.93ms
  roll-up (占 solveWorkshop median 32.63ms 的份额):
    compile          = compileMotion（每rep一次）     med 407.3µs p95 598.0µs  1.248%
    sample           = frameAtCompiled                med 1.51ms p95 2.79ms  4.624%
    solve            = solveEffectiveFrame+analyzePose med 22.16ms p95 23.13ms  67.91%
    captureSerialize = 残差+stringify                 med 10.96ms p95 11.53ms  33.59%  (残差 8.56ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 6772 samples/s · 包体 467.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 78.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.19ms/刷新 — 估算非实测
  内存: churn med 56.6MB p95 57.9MB /rep · post-gc heap 21→21→20→20→20→20→20MB

=== k100-d2 @240fps · 581 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=4067):
    frameAtCompiled      med 6.0µs p95 13.1µs
    solveEffectiveFrame  med 69.7µs p95 82.4µs
    analyzePose          med 23.6µs p95 26.3µs
    buildModel           med 104.3µs p95 219.3µs  (compat 交叉校验 n=455)
    frameFromModel       med 7.1µs p95 14.4µs  (compat 交叉校验 n=455)
    frameAt              med 105.0µs p95 227.8µs  (compat 交叉校验 n=455)
    samplePose           med 103.7µs p95 226.7µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 401.3µs p95 591.2µs
    solveWorkshop        med 75.74ms p95 77.15ms
    stringify            med 8.58ms p95 10.51ms
    probeFrames          med 65.23ms p95 66.51ms
    analyzeProbeFrames   med 7.56ms p95 8.13ms
    probeDocument        med 71.26ms p95 72.70ms
  roll-up (占 solveWorkshop median 75.74ms 的份额):
    compile          = compileMotion（每rep一次）     med 401.3µs p95 591.2µs  0.5298%
    sample           = frameAtCompiled                med 3.58ms p95 7.51ms  4.724%
    solve            = solveEffectiveFrame+analyzePose med 55.81ms p95 56.42ms  73.68%
    captureSerialize = 残差+stringify                 med 24.53ms p95 26.46ms  32.39%  (残差 15.95ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7671 samples/s · 包体 1827KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 75.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.00ms/刷新 — 估算非实测
  内存: churn med 55.5MB p95 65.2MB /rep · post-gc heap 26→26→26→26→26→26→26MB

=== k100-d5 @40fps · 301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2107):
    frameAtCompiled      med 6.2µs p95 12.4µs
    solveEffectiveFrame  med 70.5µs p95 86.2µs
    analyzePose          med 23.8µs p95 26.8µs
    buildModel           med 101.5µs p95 135.3µs  (compat 交叉校验 n=532)
    frameFromModel       med 6.8µs p95 13.8µs  (compat 交叉校验 n=532)
    frameAt              med 103.9µs p95 145.3µs  (compat 交叉校验 n=532)
    samplePose           med 103.0µs p95 143.1µs  (compat 交叉校验 n=532)
  每rep (n=7):
    compileMotion        med 403.3µs p95 575.6µs
    solveWorkshop        med 40.91ms p95 41.28ms
    stringify            med 1.93ms p95 2.13ms
    probeFrames          med 27.79ms p95 28.77ms
    analyzeProbeFrames   med 3.80ms p95 3.95ms
    probeDocument        med 31.27ms p95 31.53ms
  roll-up (占 solveWorkshop median 40.91ms 的份额):
    compile          = compileMotion（每rep一次）     med 403.3µs p95 575.6µs  0.9857%
    sample           = frameAtCompiled                med 1.93ms p95 3.06ms  4.722%
    solve            = solveEffectiveFrame+analyzePose med 29.63ms p95 31.23ms  72.42%
    captureSerialize = 残差+stringify                 med 10.88ms p95 11.08ms  26.58%  (残差 8.95ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7357 samples/s · 包体 767.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 76.8µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.07ms/刷新 — 估算非实测
  内存: churn med 49.3MB p95 50.0MB /rep · post-gc heap 22→22→23→22→22→22→22MB

=== k100-d5 @60fps · 401 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2807):
    frameAtCompiled      med 6.1µs p95 7.9µs
    solveEffectiveFrame  med 69.8µs p95 86.7µs
    analyzePose          med 23.6µs p95 26.9µs
    buildModel           med 102.7µs p95 252.3µs  (compat 交叉校验 n=469)
    frameFromModel       med 7.0µs p95 9.0µs  (compat 交叉校验 n=469)
    frameAt              med 104.3µs p95 246.9µs  (compat 交叉校验 n=469)
    samplePose           med 103.3µs p95 258.4µs  (compat 交叉校验 n=469)
  每rep (n=7):
    compileMotion        med 404.9µs p95 719.7µs
    solveWorkshop        med 52.93ms p95 54.10ms
    stringify            med 5.63ms p95 6.80ms
    probeFrames          med 40.59ms p95 42.43ms
    analyzeProbeFrames   med 5.16ms p95 5.54ms
    probeDocument        med 43.23ms p95 45.07ms
  roll-up (占 solveWorkshop median 52.93ms 的份额):
    compile          = compileMotion（每rep一次）     med 404.9µs p95 719.7µs  0.7649%
    sample           = frameAtCompiled                med 2.65ms p95 3.06ms  5.002%
    solve            = solveEffectiveFrame+analyzePose med 38.90ms p95 42.24ms  73.49%
    captureSerialize = 残差+stringify                 med 16.61ms p95 17.78ms  31.38%  (残差 10.98ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 7575 samples/s · 包体 1147KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 75.9µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 5.01ms/刷新 — 估算非实测
  内存: churn med 50.3MB p95 57.6MB /rep · post-gc heap 23→23→23→23→23→23→23MB

=== k100-d5 @240fps · 1301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=9107):
    frameAtCompiled      med 5.4µs p95 6.5µs
    solveEffectiveFrame  med 68.0µs p95 78.1µs
    analyzePose          med 23.3µs p95 25.7µs
    buildModel           med 103.8µs p95 231.6µs  (compat 交叉校验 n=462)
    frameFromModel       med 6.6µs p95 8.8µs  (compat 交叉校验 n=462)
    frameAt              med 103.8µs p95 239.9µs  (compat 交叉校验 n=462)
    samplePose           med 102.7µs p95 238.2µs  (compat 交叉校验 n=462)
  每rep (n=7):
    compileMotion        med 400.9µs p95 715.2µs
    solveWorkshop        med 161.30ms p95 162.40ms
    stringify            med 7.95ms p95 8.67ms
    probeFrames          med 151.10ms p95 157.10ms
    analyzeProbeFrames   med 19.01ms p95 19.65ms
    probeDocument        med 163.80ms p95 166.00ms
  roll-up (占 solveWorkshop median 161.30ms 的份额):
    compile          = compileMotion（每rep一次）     med 400.9µs p95 715.2µs  0.2485%
    sample           = frameAtCompiled                med 7.16ms p95 8.06ms  4.436%
    solve            = solveEffectiveFrame+analyzePose med 120.80ms p95 124.90ms  74.88%
    captureSerialize = 残差+stringify                 med 40.91ms p95 41.64ms  25.36%  (残差 32.97ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 8065 samples/s · 包体 4547KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 73.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 4.84ms/刷新 — 估算非实测
  内存: churn med 56.0MB p95 77.5MB /rep · post-gc heap 37→37→37→37→37→37→37MB

=== hotspots（全场景份额排序）===
  1. solve              77.52%
  2. captureSerialize   28.07%
  3. sample             4.002%
  4. compile            0.289%
  render             未测量（浏览器侧另计）

=== 基线对比 2026-10-18T05:55:44.250Z → 2026-10-18T09:10:34.652Z ===
⚠ 仅同机同环境可比：不同机器/负载的绝对数字不构成加速证据；median 噪声按 ±5% 计、p95 更噪。
  [default-5k@40]
    compileMotion        med   -1.2%  p95  -27.1%
    frameAtCompiled      med   +0.4%  p95  -21.4%
    buildModel           med   -2.8%  p95  -15.7%
    frameFromModel       med   -5.1%  p95  -13.3%
    solveEffectiveFrame  med  -86.1%  p95  -80.9%
    analyzePose          med  -11.9%  p95  -20.5%
    solveWorkshop        med  -74.2%  p95  -66.7%
    stringify            med   -7.4%  p95  +70.6%
    probeFrames          med  -75.2%  p95  -62.2%
    analyzeProbeFrames   med   -0.3%  p95   +0.6%
    probeDocument        med  -75.2%  p95  -60.2%
    rollup.compile       med   -1.2%  p95  -27.1%
    rollup.sample        med  +10.2%  p95  -13.1%
    rollup.solve         med  -81.6%  p95  -77.6%
    rollup.captureSerialize med  +10.9%  p95  +36.6%
  [default-5k@60]
    compileMotion        med   -3.4%  p95  -12.1%
    frameAtCompiled      med  +40.6%  p95  +62.3%
    buildModel           med   -4.4%  p95  -41.6%
    frameFromModel       med  +15.6%  p95  +38.1%
    solveEffectiveFrame  med  -87.6%  p95  -87.4%
    analyzePose          med  -14.8%  p95  -30.8%
    solveWorkshop        med  -73.9%  p95  -74.2%
    stringify            med   -0.4%  p95   +0.6%
    probeFrames          med  -76.3%  p95  -75.5%
    analyzeProbeFrames   med   -2.5%  p95   -4.3%
    probeDocument        med  -75.9%  p95  -75.9%
    rollup.compile       med   -3.4%  p95  -12.1%
    rollup.sample        med  +97.2%  p95  +57.6%
    rollup.solve         med  -83.5%  p95  -83.6%
    rollup.captureSerialize med  +36.6%  p95  +35.9%
  [default-5k@240]
    compileMotion        med  -18.4%  p95  -44.9%
    frameAtCompiled      med   +4.5%  p95  +41.9%
    buildModel           med  -11.7%  p95  -12.3%
    frameFromModel       med   +2.0%  p95  +21.1%
    solveEffectiveFrame  med  -88.1%  p95  -85.1%
    analyzePose          med  -15.6%  p95  -15.7%
    solveWorkshop        med  -81.9%  p95  -86.9%
    stringify            med  -66.6%  p95   -4.6%
    probeFrames          med  -81.3%  p95  -85.8%
    analyzeProbeFrames   med  -12.0%  p95  -50.1%
    probeDocument        med  -81.0%  p95  -81.3%
    rollup.compile       med  -18.4%  p95  -44.9%
    rollup.sample        med   -1.1%  p95  +44.5%
    rollup.solve         med  -84.3%  p95  -81.8%
    rollup.captureSerialize med  -59.3%  p95  -36.1%
  [forehand-49k@40]
    compileMotion        med  -14.0%  p95  -21.6%
    frameAtCompiled      med  -21.5%  p95  -84.3%
    buildModel           med  -31.4%  p95  -35.4%
    frameFromModel       med  -27.1%  p95  -86.7%
    solveEffectiveFrame  med  -88.6%  p95  -92.5%
    analyzePose          med  -22.6%  p95  -66.5%
    solveWorkshop        med  -82.0%  p95  -82.0%
    stringify            med   +2.6%  p95   +2.0%
    probeFrames          med  -80.3%  p95  -81.3%
    analyzeProbeFrames   med   -5.2%  p95   +1.4%
    probeDocument        med  -79.0%  p95  -78.9%
    rollup.compile       med  -14.0%  p95  -21.6%
    rollup.sample        med  -14.6%  p95  -83.7%
    rollup.solve         med  -84.9%  p95  -89.8%
    rollup.captureSerialize med   +3.92ms  p95   +3.90ms  (残差基数近零，按绝对差)
  [forehand-49k@60]
    compileMotion        med   +8.0%  p95  +35.7%
    frameAtCompiled      med   -7.0%  p95   +2.4%
    buildModel           med   -1.9%  p95   -8.4%
    frameFromModel       med   -8.8%  p95  +31.5%
    solveEffectiveFrame  med  -88.2%  p95  -89.3%
    analyzePose          med  -14.2%  p95  -49.7%
    solveWorkshop        med  -82.2%  p95  -82.3%
    stringify            med   -3.2%  p95  -63.3%
    probeFrames          med  -81.1%  p95  -84.0%
    analyzeProbeFrames   med   +7.2%  p95  -42.2%
    probeDocument        med  -79.4%  p95  -82.5%
    rollup.compile       med   +8.0%  p95  +35.7%
    rollup.sample        med  -16.2%  p95  +81.1%
    rollup.solve         med  -84.5%  p95  -85.5%
    rollup.captureSerialize med   -0.39ms  p95   -4.67ms  (残差基数近零，按绝对差)
  [forehand-49k@240]
    compileMotion        med   -6.6%  p95   -2.7%
    frameAtCompiled      med   -8.3%  p95  -60.6%
    buildModel           med  -18.5%  p95  -15.9%
    frameFromModel       med  -11.7%  p95  -54.4%
    solveEffectiveFrame  med  -88.6%  p95  -92.1%
    analyzePose          med  -15.8%  p95  -60.4%
    solveWorkshop        med  -83.2%  p95  -84.3%
    stringify            med   -0.1%  p95  -22.2%
    probeFrames          med  -81.7%  p95  -82.8%
    analyzeProbeFrames   med   -5.0%  p95  -16.0%
    probeDocument        med  -82.7%  p95  -82.6%
    rollup.compile       med   -6.6%  p95   -2.7%
    rollup.sample        med  -20.9%  p95  -50.7%
    rollup.solve         med  -85.9%  p95  -88.8%
    rollup.captureSerialize med  +15.33ms  p95  +12.25ms  (残差基数近零，按绝对差)
  [k5-d2@40]
    compileMotion        med   -5.2%  p95  -13.1%
    frameAtCompiled      med   -2.7%  p95   -9.0%
    buildModel           med   +3.5%  p95  -19.5%
    frameFromModel       med   -5.0%  p95  -38.5%
    solveEffectiveFrame  med  -87.3%  p95  -87.1%
    analyzePose          med  -13.7%  p95  -31.3%
    solveWorkshop        med  -76.8%  p95  -84.5%
    stringify            med   -2.8%  p95   -9.2%
    probeFrames          med  -79.3%  p95  -84.5%
    analyzeProbeFrames   med   -6.4%  p95  -39.0%
    probeDocument        med  -76.7%  p95  -84.0%
    rollup.compile       med   -5.2%  p95  -13.1%
    rollup.sample        med   -4.4%  p95   -3.2%
    rollup.solve         med  -83.9%  p95  -83.2%
    rollup.captureSerialize med  +44.2%  p95  +37.6%
  [k5-d2@60]
    compileMotion        med  +11.2%  p95  -11.2%
    frameAtCompiled      med   +5.0%  p95  +71.6%
    buildModel           med  +31.8%  p95  -19.2%
    frameFromModel       med   -1.8%  p95  +31.0%
    solveEffectiveFrame  med  -87.9%  p95  -88.0%
    analyzePose          med  -15.4%  p95  -31.4%
    solveWorkshop        med  -78.9%  p95  -79.5%
    stringify            med   -8.3%  p95  +11.7%
    probeFrames          med  -80.7%  p95  -79.8%
    analyzeProbeFrames   med   -2.2%  p95   -3.8%
    probeDocument        med  -78.4%  p95  -78.3%
    rollup.compile       med  +11.2%  p95  -11.2%
    rollup.sample        med   -2.5%  p95  +93.4%
    rollup.solve         med  -84.6%  p95  -84.3%
    rollup.captureSerialize med  +28.9%  p95  +38.3%
  [k5-d2@240]
    compileMotion        med  -11.4%  p95  -39.7%
    frameAtCompiled      med  -13.8%  p95  -68.9%
    buildModel           med  -14.3%  p95  -57.0%
    frameFromModel       med  -19.5%  p95  -66.8%
    solveEffectiveFrame  med  -88.5%  p95  -92.9%
    analyzePose          med  -18.6%  p95  -64.4%
    solveWorkshop        med  -82.4%  p95  -87.8%
    stringify            med   -3.1%  p95  -20.0%
    probeFrames          med  -81.7%  p95  -85.4%
    analyzeProbeFrames   med   +2.8%  p95  -40.0%
    probeDocument        med  -83.4%  p95  -86.1%
    rollup.compile       med  -11.4%  p95  -39.7%
    rollup.sample        med  -16.3%  p95  -63.1%
    rollup.solve         med  -85.1%  p95  -89.8%
    rollup.captureSerialize med   -9.3%  p95  -17.8%
  [k5-d5@40]
    compileMotion        med   -3.1%  p95  -16.6%
    frameAtCompiled      med   -4.9%  p95  -28.4%
    buildModel           med   -5.7%  p95  -40.1%
    frameFromModel       med   -7.3%  p95  -23.3%
    solveEffectiveFrame  med  -88.2%  p95  -88.6%
    analyzePose          med  -14.9%  p95  -35.5%
    solveWorkshop        med  -79.2%  p95  -79.5%
    stringify            med   +2.6%  p95   -2.3%
    probeFrames          med  -79.4%  p95  -83.4%
    analyzeProbeFrames   med   -5.7%  p95  -44.8%
    probeDocument        med  -78.0%  p95  -79.1%
    rollup.compile       med   -3.1%  p95  -16.6%
    rollup.sample        med   -7.0%  p95  -11.1%
    rollup.solve         med  -84.8%  p95  -84.9%
    rollup.captureSerialize med  +23.0%  p95  +20.0%
  [k5-d5@60]
    compileMotion        med   -9.5%  p95  -22.7%
    frameAtCompiled      med   +9.3%  p95  +10.1%
    buildModel           med  -31.6%  p95  -60.3%
    frameFromModel       med   +5.6%  p95   +4.2%
    solveEffectiveFrame  med  -88.2%  p95  -89.5%
    analyzePose          med  -14.4%  p95  -43.3%
    solveWorkshop        med  -82.3%  p95  -83.2%
    stringify            med +143.1%  p95 +143.5%
    probeFrames          med  -81.0%  p95  -86.5%
    analyzeProbeFrames   med  -12.8%  p95  -31.8%
    probeDocument        med  -79.7%  p95  -85.4%
    rollup.compile       med   -9.5%  p95  -22.7%
    rollup.sample        med   -3.4%  p95  +67.3%
    rollup.solve         med  -85.0%  p95  -86.0%
    rollup.captureSerialize med   +2.90ms  p95   +3.10ms  (残差基数近零，按绝对差)
  [k5-d5@240]
    compileMotion        med  -20.1%  p95   +9.8%
    frameAtCompiled      med   -7.8%  p95  -65.3%
    buildModel           med  -27.0%  p95  -46.7%
    frameFromModel       med  -16.6%  p95  -59.1%
    solveEffectiveFrame  med  -88.4%  p95  -91.8%
    analyzePose          med  -15.8%  p95  -58.9%
    solveWorkshop        med  -83.7%  p95  -84.2%
    stringify            med +188.3%  p95  +16.2%
    probeFrames          med  -81.9%  p95  -85.8%
    analyzeProbeFrames   med   -3.8%  p95  -42.1%
    probeDocument        med  -81.9%  p95  -83.8%
    rollup.compile       med  -20.1%  p95   +9.8%
    rollup.sample        med  -27.9%  p95  -36.4%
    rollup.solve         med  -86.0%  p95  -86.5%
    rollup.captureSerialize med   +4.06ms  p95   -7.77ms  (残差基数近零，按绝对差)
  [k20-d2@40]
    compileMotion        med   -1.7%  p95   +3.2%
    frameAtCompiled      med   -0.7%  p95   -2.4%
    buildModel           med   -3.6%  p95  -19.4%
    frameFromModel       med   -9.6%  p95   -5.9%
    solveEffectiveFrame  med  -87.5%  p95  -87.1%
    analyzePose          med  -13.4%  p95  -31.3%
    solveWorkshop        med  -76.2%  p95  -77.3%
    stringify            med  -17.5%  p95   +8.1%
    probeFrames          med  -78.9%  p95  -77.6%
    analyzeProbeFrames   med   -7.8%  p95  -15.4%
    probeDocument        med  -76.3%  p95  -73.5%
    rollup.compile       med   -1.7%  p95   +3.2%
    rollup.sample        med   -2.9%  p95   +5.4%
    rollup.solve         med  -84.2%  p95  -83.3%
    rollup.captureSerialize med  +25.9%  p95  +32.9%
  [k20-d2@60]
    compileMotion        med   -1.2%  p95  +10.4%
    frameAtCompiled      med  -34.1%  p95   -4.5%
    buildModel           med  -12.9%  p95  -10.0%
    frameFromModel       med  -37.5%  p95  -13.0%
    solveEffectiveFrame  med  -87.8%  p95  -86.3%
    analyzePose          med  -13.5%  p95  -28.7%
    solveWorkshop        med  -78.0%  p95  -75.0%
    stringify            med   +4.4%  p95  +19.9%
    probeFrames          med  -78.2%  p95  -82.2%
    analyzeProbeFrames   med   +3.2%  p95  -34.5%
    probeDocument        med  -77.5%  p95  -78.8%
    rollup.compile       med   -1.2%  p95  +10.4%
    rollup.sample        med  -37.0%  p95  +12.3%
    rollup.solve         med  -84.1%  p95  -84.3%
    rollup.captureSerialize med  +60.9%  p95  +64.0%
  [k20-d2@240]
    compileMotion        med  -19.3%  p95  -23.8%
    frameAtCompiled      med   -8.2%  p95  -47.8%
    buildModel           med  -30.6%  p95  -34.4%
    frameFromModel       med  -12.7%  p95  -40.6%
    solveEffectiveFrame  med  -88.2%  p95  -89.8%
    analyzePose          med  -15.1%  p95  -46.6%
    solveWorkshop        med  -80.5%  p95  -82.9%
    stringify            med   +1.0%  p95   +0.2%
    probeFrames          med  -80.6%  p95  -80.1%
    analyzeProbeFrames   med   -3.9%  p95  -12.3%
    probeDocument        med  -79.5%  p95  -83.8%
    rollup.compile       med  -19.3%  p95  -23.8%
    rollup.sample        med  -14.4%  p95  -30.3%
    rollup.solve         med  -84.9%  p95  -85.7%
    rollup.captureSerialize med   +6.93ms  p95   +6.86ms  (残差基数近零，按绝对差)
  [k20-d5@40]
    compileMotion        med   -0.5%  p95  -19.8%
    frameAtCompiled      med   -4.9%  p95  -54.8%
    buildModel           med   -7.6%  p95  -38.4%
    frameFromModel       med   -7.0%  p95  -59.3%
    solveEffectiveFrame  med  -88.1%  p95  -91.6%
    analyzePose          med  -15.7%  p95  -59.6%
    solveWorkshop        med  -78.7%  p95  -81.0%
    stringify            med   -0.7%  p95   -8.1%
    probeFrames          med  -79.1%  p95  -84.3%
    analyzeProbeFrames   med   -1.8%  p95   -5.0%
    probeDocument        med  -78.2%  p95  -82.1%
    rollup.compile       med   -0.5%  p95  -19.8%
    rollup.sample        med   -7.8%  p95  -37.9%
    rollup.solve         med  -84.8%  p95  -87.0%
    rollup.captureSerialize med  +32.5%  p95  +26.9%
  [k20-d5@60]
    compileMotion        med  +18.5%  p95   -9.3%
    frameAtCompiled      med  +18.7%  p95  +25.9%
    buildModel           med   -9.6%  p95  +12.5%
    frameFromModel       med  +18.2%  p95  +13.8%
    solveEffectiveFrame  med  -88.2%  p95  -88.0%
    analyzePose          med  -13.7%  p95  -33.2%
    solveWorkshop        med  -79.5%  p95  -86.0%
    stringify            med +119.3%  p95  +17.6%
    probeFrames          med  -84.1%  p95  -86.3%
    analyzeProbeFrames   med   -8.8%  p95  -51.8%
    probeDocument        med  -78.8%  p95  -83.5%
    rollup.compile       med  +18.5%  p95   -9.3%
    rollup.sample        med  +11.5%  p95  +70.4%
    rollup.solve         med  -84.8%  p95  -84.7%
    rollup.captureSerialize med   +7.68ms  p95   +5.36ms  (残差基数近零，按绝对差)
  [k20-d5@240]
    compileMotion        med  -12.2%  p95  -20.9%
    frameAtCompiled      med   -7.1%  p95  -62.2%
    buildModel           med  -38.3%  p95  -50.3%
    frameFromModel       med  -13.3%  p95  -57.5%
    solveEffectiveFrame  med  -88.6%  p95  -92.5%
    analyzePose          med  -16.7%  p95  -62.5%
    solveWorkshop        med  -83.8%  p95  -86.3%
    stringify            med   -8.0%  p95  +68.5%
    probeFrames          med  -82.1%  p95  -83.4%
    analyzeProbeFrames   med   -5.8%  p95  -28.2%
    probeDocument        med  -81.4%  p95  -83.4%
    rollup.compile       med  -12.2%  p95  -20.9%
    rollup.sample        med  -29.2%  p95  -38.9%
    rollup.solve         med  -86.5%  p95  -87.8%
    rollup.captureSerialize med  -49.1%  p95  -32.7%
  [k20-d5-nib@40]
    compileMotion        med   -3.3%  p95  -37.2%
    frameAtCompiled      med  -20.0%  p95  -66.9%
    buildModel           med  -10.8%  p95  -35.6%
    frameFromModel       med  -31.6%  p95  -69.5%
    solveEffectiveFrame  med  -88.2%  p95  -89.7%
    analyzePose          med  -14.1%  p95  -46.0%
    solveWorkshop        med  -82.1%  p95  -82.8%
    stringify            med   -0.6%  p95  -22.2%
    probeFrames          med  -81.2%  p95  -87.7%
    analyzeProbeFrames   med   -3.7%  p95  -39.4%
    probeDocument        med  -82.1%  p95  -84.4%
    rollup.compile       med   -3.3%  p95  -37.2%
    rollup.sample        med  -30.4%  p95  -50.6%
    rollup.solve         med  -84.7%  p95  -86.6%
    rollup.captureSerialize med   +9.6%  p95   -5.9%
  [k20-d5-nib@60]
    compileMotion        med  +15.0%  p95   -9.9%
    frameAtCompiled      med  -22.5%  p95  -81.7%
    buildModel           med  -27.5%  p95  -45.2%
    frameFromModel       med  -30.9%  p95  -80.3%
    solveEffectiveFrame  med  -88.5%  p95  -93.0%
    analyzePose          med  -18.6%  p95  -64.4%
    solveWorkshop        med  -82.6%  p95  -82.3%
    stringify            med +138.8%  p95 +161.7%
    probeFrames          med  -81.4%  p95  -87.5%
    analyzeProbeFrames   med   -6.0%  p95   -5.6%
    probeDocument        med  -79.8%  p95  -80.3%
    rollup.compile       med  +15.0%  p95   -9.9%
    rollup.sample        med  -28.7%  p95  -76.1%
    rollup.solve         med  -84.9%  p95  -89.9%
    rollup.captureSerialize med   +6.38ms  p95   +7.16ms  (残差基数近零，按绝对差)
  [k20-d5-nib@240]
    compileMotion        med  -13.2%  p95  -12.6%
    frameAtCompiled      med  -31.4%  p95  -82.0%
    buildModel           med  -40.8%  p95  -49.1%
    frameFromModel       med  -53.8%  p95  -76.3%
    solveEffectiveFrame  med  -88.7%  p95  -92.3%
    analyzePose          med  -16.2%  p95  -60.9%
    solveWorkshop        med  -84.5%  p95  -87.9%
    stringify            med   +3.5%  p95  -35.9%
    probeFrames          med  -82.2%  p95  -83.4%
    analyzeProbeFrames   med   +1.7%  p95   -3.1%
    probeDocument        med  -82.5%  p95  -83.7%
    rollup.compile       med  -13.2%  p95  -12.6%
    rollup.sample        med  -47.9%  p95  -68.3%
    rollup.solve         med  -85.8%  p95  -88.5%
    rollup.captureSerialize med  -59.6%  p95  -56.4%
  [k100-d2@40]
    compileMotion        med   -4.1%  p95  -35.4%
    frameAtCompiled      med   -1.9%  p95  -43.8%
    buildModel           med   -4.9%  p95  -52.8%
    frameFromModel       med   -5.2%  p95  -55.7%
    solveEffectiveFrame  med  -87.1%  p95  -90.4%
    analyzePose          med  -14.1%  p95  -57.8%
    solveWorkshop        med  -78.2%  p95  -80.7%
    stringify            med  -15.0%  p95   -4.5%
    probeFrames          med  -78.3%  p95  -78.2%
    analyzeProbeFrames   med   -7.8%  p95   -2.3%
    probeDocument        med  -76.6%  p95  -82.1%
    rollup.compile       med   -4.1%  p95  -35.4%
    rollup.sample        med  -11.9%  p95  -19.1%
    rollup.solve         med  -84.6%  p95  -85.6%
    rollup.captureSerialize med   +8.34ms  p95   +8.53ms  (残差基数近零，按绝对差)
  [k100-d2@60]
    compileMotion        med   -2.9%  p95  -27.6%
    frameAtCompiled      med   -7.6%  p95  -12.1%
    buildModel           med   -8.7%  p95   -0.9%
    frameFromModel       med  -13.5%  p95  -24.1%
    solveEffectiveFrame  med  -88.1%  p95  -87.4%
    analyzePose          med  -15.3%  p95  -35.9%
    solveWorkshop        med  -78.0%  p95  -83.7%
    stringify            med   -8.8%  p95   +8.9%
    probeFrames          med  -78.4%  p95  -83.3%
    analyzeProbeFrames   med   -0.8%  p95  -44.2%
    probeDocument        med  -77.4%  p95  -83.7%
    rollup.compile       med   -2.9%  p95  -27.6%
    rollup.sample        med  -20.5%  p95  -12.4%
    rollup.solve         med  -84.5%  p95  -85.0%
    rollup.captureSerialize med   +5.89ms  p95   +6.37ms  (残差基数近零，按绝对差)
  [k100-d2@240]
    compileMotion        med   -7.6%  p95   -2.0%
    frameAtCompiled      med   -2.6%  p95  -24.6%
    buildModel           med  -20.9%  p95  -21.1%
    frameFromModel       med   -9.8%  p95  -32.6%
    solveEffectiveFrame  med  -88.4%  p95  -91.5%
    analyzePose          med  -15.9%  p95  -59.4%
    solveWorkshop        med  -83.8%  p95  -85.9%
    stringify            med   -2.5%  p95   +5.6%
    probeFrames          med  -80.0%  p95  -83.9%
    analyzeProbeFrames   med   -5.1%  p95  -27.1%
    probeDocument        med  -79.7%  p95  -85.0%
    rollup.compile       med   -7.6%  p95   -2.0%
    rollup.sample        med   -5.6%  p95   -6.0%
    rollup.solve         med  -84.8%  p95  -88.7%
    rollup.captureSerialize med  -76.6%  p95  -75.0%
  [k100-d5@40]
    compileMotion        med   -2.1%  p95   -7.5%
    frameAtCompiled      med   -1.6%  p95  +37.2%
    buildModel           med   -8.8%  p95   -6.8%
    frameFromModel       med   -6.7%  p95  +28.2%
    solveEffectiveFrame  med  -88.3%  p95  -87.1%
    analyzePose          med  -14.7%  p95  -32.5%
    solveWorkshop        med  -79.5%  p95  -86.7%
    stringify            med   -5.3%  p95  -52.1%
    probeFrames          med  -79.4%  p95  -82.5%
    analyzeProbeFrames   med   -5.5%  p95  -47.8%
    probeDocument        med  -77.5%  p95  -84.6%
    rollup.compile       med   -2.1%  p95   -7.5%
    rollup.sample        med   -0.9%  p95  +39.4%
    rollup.solve         med  -84.6%  p95  -84.0%
    rollup.captureSerialize med   +4.29ms  p95   +2.08ms  (残差基数近零，按绝对差)
  [k100-d5@60]
    compileMotion        med   -5.4%  p95   -0.8%
    frameAtCompiled      med   -8.6%  p95  -55.8%
    buildModel           med  -17.4%  p95   -9.7%
    frameFromModel       med  -17.1%  p95  -55.9%
    solveEffectiveFrame  med  -88.4%  p95  -91.2%
    analyzePose          med  -15.6%  p95  -60.8%
    solveWorkshop        med  -80.4%  p95  -81.1%
    stringify            med  +81.9%  p95   +1.3%
    probeFrames          med  -80.1%  p95  -80.7%
    analyzeProbeFrames   med   -3.1%  p95   +0.9%
    probeDocument        med  -79.2%  p95  -82.8%
    rollup.compile       med   -5.4%  p95   -0.8%
    rollup.sample        med   -8.3%  p95  -49.3%
    rollup.solve         med  -84.9%  p95  -88.9%
    rollup.captureSerialize med   +3.47ms  p95   +1.02ms  (残差基数近零，按绝对差)
  [k100-d5@240]
    compileMotion        med   -3.3%  p95   -4.8%
    frameAtCompiled      med  -10.8%  p95  -65.7%
    buildModel           med  -27.1%  p95  -25.0%
    frameFromModel       med  -23.2%  p95  -59.9%
    solveEffectiveFrame  med  -88.8%  p95  -92.4%
    analyzePose          med  -16.2%  p95  -62.7%
    solveWorkshop        med  -83.6%  p95  -85.8%
    stringify            med   -7.6%  p95  -14.7%
    probeFrames          med  -83.8%  p95  -84.7%
    analyzeProbeFrames   med  -10.4%  p95  -41.0%
    probeDocument        med  -83.0%  p95  -86.3%
    rollup.compile       med   -3.3%  p95   -4.8%
    rollup.sample        med  -29.1%  p95  -48.7%
    rollup.solve         med  -86.3%  p95  -88.3%
    rollup.captureSerialize med  -59.8%  p95  -59.7%
