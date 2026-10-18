=== workshop-pipeline 性能基线 · 2026-10-18T05:55:44.250Z ===
env: node v25.8.1 darwin-x64 · Intel(R) Core(TM) i7-14700KF 28核 64GB · three 0.180.0 · tsx 4.23.15 · commit b36a6c9
cmd: node --import tsx --expose-gc scripts/bench-workshop.mts --compare evidence/bench-workshop.json --out evidence/bench-workshop-prb.json --report evidence/bench-workshop-report-prb.md
params: seed 1 warmup 2 reps 7 gc available
口径: 全部为 µs · 阶段帧级分摊=compile(compileMotion·每rep一次)/sample(frameAtCompiled)/solve(solveEffectiveFrame+analyzePose)/render(未测量) · captureSerialize=残差+stringify
    残差可为负（两段测量回路的中位噪声）；captureSerialize 含 stringify，四桶份额不必合计 100%

=== default-5k @40fps · 38 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=266):
    frameAtCompiled      med 5.5µs p95 21.5µs
    solveEffectiveFrame  med 615.2µs p95 692.0µs
    analyzePose          med 34.9µs p95 61.8µs
    buildModel           med 10.8µs p95 37.5µs  (compat 交叉校验 n=266)
    frameFromModel       med 6.2µs p95 19.5µs  (compat 交叉校验 n=266)
    frameAt              med 14.7µs p95 59.2µs  (compat 交叉校验 n=266)
    samplePose           med 14.4µs p95 57.7µs  (compat 交叉校验 n=266)
  每rep (n=7):
    compileMotion        med 49.5µs p95 152.9µs
    solveWorkshop        med 27.00ms p95 27.32ms
    stringify            med 827.1µs p95 879.0µs
    probeFrames          med 23.38ms p95 24.20ms
    analyzeProbeFrames   med 670.6µs p95 734.9µs
    probeDocument        med 23.38ms p95 23.98ms
  roll-up (占 solveWorkshop median 27.00ms 的份额):
    compile          = compileMotion（每rep一次）     med 49.5µs p95 152.9µs  0.1834%
    sample           = frameAtCompiled                med 209.2µs p95 608.8µs  0.7748%
    solve            = solveEffectiveFrame+analyzePose med 24.98ms p95 26.72ms  92.52%
    captureSerialize = 残差+stringify                 med 2.59ms p95 2.64ms  9.586%  (残差 1.76ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1407 samples/s · 包体 133.2KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 620.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.97ms/刷新 — 估算非实测
  内存: churn med 13.6MB p95 14.1MB /rep · post-gc heap 19→19→19→19→19→19→19MB

=== default-5k @60fps · 54 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=378):
    frameAtCompiled      med 5.1µs p95 10.4µs
    solveEffectiveFrame  med 606.2µs p95 688.6µs
    analyzePose          med 33.3µs p95 48.2µs
    buildModel           med 13.1µs p95 25.0µs  (compat 交叉校验 n=378)
    frameFromModel       med 5.7µs p95 12.5µs  (compat 交叉校验 n=378)
    frameAt              med 16.9µs p95 24.6µs  (compat 交叉校验 n=378)
    samplePose           med 16.6µs p95 23.6µs  (compat 交叉校验 n=378)
  每rep (n=7):
    compileMotion        med 37.1µs p95 74.3µs
    solveWorkshop        med 37.63ms p95 38.60ms
    stringify            med 1.05ms p95 1.14ms
    probeFrames          med 33.71ms p95 34.03ms
    analyzeProbeFrames   med 903.6µs p95 991.3µs
    probeDocument        med 34.37ms p95 36.32ms
  roll-up (占 solveWorkshop median 37.63ms 的份额):
    compile          = compileMotion（每rep一次）     med 37.1µs p95 74.3µs  0.09861%
    sample           = frameAtCompiled                med 277.6µs p95 562.1µs  0.7376%
    solve            = solveEffectiveFrame+analyzePose med 35.06ms p95 36.16ms  93.16%
    captureSerialize = 残差+stringify                 med 3.31ms p95 3.40ms  8.786%  (残差 2.26ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1435 samples/s · 包体 196.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 611.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.35ms/刷新 — 估算非实测
  内存: churn med 8.1MB p95 24.3MB /rep · post-gc heap 19→20→20→20→20→20→19MB

=== default-5k @240fps · 198 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=1386):
    frameAtCompiled      med 4.9µs p95 7.7µs
    solveEffectiveFrame  med 597.4µs p95 662.9µs
    analyzePose          med 30.8µs p95 45.6µs
    buildModel           med 14.5µs p95 30.9µs  (compat 交叉校验 n=462)
    frameFromModel       med 5.2µs p95 9.6µs  (compat 交叉校验 n=462)
    frameAt              med 16.2µs p95 21.5µs  (compat 交叉校验 n=462)
    samplePose           med 15.7µs p95 20.4µs  (compat 交叉校验 n=462)
  每rep (n=7):
    compileMotion        med 44.7µs p95 89.5µs
    solveWorkshop        med 135.10ms p95 193.70ms
    stringify            med 4.45ms p95 4.80ms
    probeFrames          med 136.90ms p95 184.60ms
    analyzeProbeFrames   med 3.26ms p95 6.52ms
    probeDocument        med 146.40ms p95 193.00ms
  roll-up (占 solveWorkshop median 135.10ms 的份额):
    compile          = compileMotion（每rep一次）     med 44.7µs p95 89.5µs  0.0331%
    sample           = frameAtCompiled                med 1.05ms p95 1.13ms  0.7758%
    solve            = solveEffectiveFrame+analyzePose med 126.10ms p95 130.90ms  93.35%
    captureSerialize = 残差+stringify                 med 12.35ms p95 12.70ms  9.139%  (残差 7.89ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1466 samples/s · 包体 760.6KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 602.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.75ms/刷新 — 估算非实测
  内存: churn med 18.8MB p95 46.6MB /rep · post-gc heap 22→22→23→22→22→22→22MB

=== forehand-49k @40fps · 258 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=1806):
    frameAtCompiled      med 6.9µs p95 42.0µs
    solveEffectiveFrame  med 616.6µs p95 1.13ms
    analyzePose          med 31.3µs p95 81.3µs
    buildModel           med 79.4µs p95 168.8µs  (compat 交叉校验 n=455)
    frameFromModel       med 7.5µs p95 47.9µs  (compat 交叉校验 n=455)
    frameAt              med 75.5µs p95 163.2µs  (compat 交叉校验 n=455)
    samplePose           med 74.6µs p95 152.5µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 242.2µs p95 439.1µs
    solveWorkshop        med 169.20ms p95 172.50ms
    stringify            med 4.48ms p95 4.91ms
    probeFrames          med 140.00ms p95 148.30ms
    analyzeProbeFrames   med 3.62ms p95 3.68ms
    probeDocument        med 143.40ms p95 144.70ms
  roll-up (占 solveWorkshop median 169.20ms 的份额):
    compile          = compileMotion（每rep一次）     med 242.2µs p95 439.1µs  0.1432%
    sample           = frameAtCompiled                med 1.67ms p95 9.06ms  0.9847%
    solve            = solveEffectiveFrame+analyzePose med 167.50ms p95 256.90ms  99%
    captureSerialize = 残差+stringify                 med 4.25ms p95 4.68ms  2.514%  (残差 -223.6µs)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1525 samples/s · 包体 823KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 623.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 41.14ms/刷新 — 估算非实测
  内存: churn med 36.1MB p95 39.5MB /rep · post-gc heap 22→24→22→22→22→22→22MB

=== forehand-49k @60fps · 362 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=2534):
    frameAtCompiled      med 6.3µs p95 16.8µs
    solveEffectiveFrame  med 597.2µs p95 808.0µs
    analyzePose          med 28.1µs p95 55.1µs
    buildModel           med 57.8µs p95 113.7µs  (compat 交叉校验 n=511)
    frameFromModel       med 7.3µs p95 18.3µs  (compat 交叉校验 n=511)
    frameAt              med 58.9µs p95 103.5µs  (compat 交叉校验 n=511)
    samplePose           med 57.5µs p95 101.8µs  (compat 交叉校验 n=511)
  每rep (n=7):
    compileMotion        med 206.8µs p95 291.9µs
    solveWorkshop        med 237.00ms p95 244.70ms
    stringify            med 2.49ms p95 6.88ms
    probeFrames          med 210.20ms p95 253.60ms
    analyzeProbeFrames   med 5.00ms p95 9.55ms
    probeDocument        med 214.90ms p95 255.40ms
  roll-up (占 solveWorkshop median 237.00ms 的份额):
    compile          = compileMotion（每rep一次）     med 206.8µs p95 291.9µs  0.08727%
    sample           = frameAtCompiled                med 2.66ms p95 3.65ms  1.124%
    solve            = solveEffectiveFrame+analyzePose med 229.60ms p95 265.50ms  96.9%
    captureSerialize = 残差+stringify                 med 6.97ms p95 11.37ms  2.941%  (残差 4.48ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1528 samples/s · 包体 1232KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 603.5µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.83ms/刷新 — 估算非实测
  内存: churn med 47.0MB p95 47.9MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== forehand-49k @240fps · 1298 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=9086):
    frameAtCompiled      med 5.6µs p95 15.5µs
    solveEffectiveFrame  med 597.2µs p95 985.1µs
    analyzePose          med 28.1µs p95 65.9µs
    buildModel           med 67.0µs p95 125.9µs  (compat 交叉校验 n=455)
    frameFromModel       med 6.5µs p95 15.6µs  (compat 交叉校验 n=455)
    frameAt              med 59.7µs p95 114.0µs  (compat 交叉校验 n=455)
    samplePose           med 57.7µs p95 111.6µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 224.6µs p95 296.5µs
    solveWorkshop        med 883.10ms p95 962.70ms
    stringify            med 10.09ms p95 13.86ms
    probeFrames          med 842.90ms p95 903.60ms
    analyzeProbeFrames   med 15.45ms p95 22.44ms
    probeDocument        med 962.30ms p95 987.60ms
  roll-up (占 solveWorkshop median 883.10ms 的份额):
    compile          = compileMotion（每rep一次）     med 224.6µs p95 296.5µs  0.02543%
    sample           = frameAtCompiled                med 8.68ms p95 14.42ms  0.9832%
    solve            = solveEffectiveFrame+analyzePose med 870.30ms p95 1092.00ms  98.56%
    captureSerialize = 残差+stringify                 med 13.94ms p95 17.72ms  1.579%  (残差 3.85ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1470 samples/s · 包体 4901KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 602.8µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.78ms/刷新 — 估算非实测
  内存: churn med 61.1MB p95 73.6MB /rep · post-gc heap 40→40→40→40→40→40→40MB

=== k5-d2 @40fps · 86 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=602):
    frameAtCompiled      med 5.6µs p95 7.8µs
    solveEffectiveFrame  med 608.6µs p95 674.7µs
    analyzePose          med 28.8µs p95 41.0µs
    buildModel           med 8.0µs p95 15.7µs  (compat 交叉校验 n=602)
    frameFromModel       med 5.9µs p95 11.3µs  (compat 交叉校验 n=602)
    frameAt              med 12.6µs p95 17.2µs  (compat 交叉校验 n=602)
    samplePose           med 12.3µs p95 16.9µs  (compat 交叉校验 n=602)
  每rep (n=7):
    compileMotion        med 30.4µs p95 51.5µs
    solveWorkshop        med 58.45ms p95 94.68ms
    stringify            med 1.83ms p95 2.15ms
    probeFrames          med 55.37ms p95 80.21ms
    analyzeProbeFrames   med 1.63ms p95 2.54ms
    probeDocument        med 57.03ms p95 87.61ms
  roll-up (占 solveWorkshop median 58.45ms 的份额):
    compile          = compileMotion（每rep一次）     med 30.4µs p95 51.5µs  0.05204%
    sample           = frameAtCompiled                med 499.5µs p95 517.2µs  0.8545%
    solve            = solveEffectiveFrame+analyzePose med 55.69ms p95 55.98ms  95.27%
    captureSerialize = 残差+stringify                 med 4.07ms p95 4.39ms  6.954%  (残差 2.23ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1471 samples/s · 包体 309.8KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 614.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.54ms/刷新 — 估算非实测
  内存: churn med 63.0MB p95 64.9MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k5-d2 @60fps · 126 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=882):
    frameAtCompiled      med 5.2µs p95 7.1µs
    solveEffectiveFrame  med 606.5µs p95 651.8µs
    analyzePose          med 28.8µs p95 38.0µs
    buildModel           med 8.3µs p95 15.2µs  (compat 交叉校验 n=882)
    frameFromModel       med 5.8µs p95 9.7µs  (compat 交叉校验 n=882)
    frameAt              med 12.5µs p95 15.8µs  (compat 交叉校验 n=882)
    samplePose           med 12.2µs p95 15.2µs  (compat 交叉校验 n=882)
  每rep (n=7):
    compileMotion        med 29.0µs p95 56.8µs
    solveWorkshop        med 84.47ms p95 88.84ms
    stringify            med 2.60ms p95 2.63ms
    probeFrames          med 82.13ms p95 82.38ms
    analyzeProbeFrames   med 2.19ms p95 2.29ms
    probeDocument        med 83.87ms p95 85.13ms
  roll-up (占 solveWorkshop median 84.47ms 的份额):
    compile          = compileMotion（每rep一次）     med 29.0µs p95 56.8µs  0.03432%
    sample           = frameAtCompiled                med 679.0µs p95 804.0µs  0.8038%
    solve            = solveEffectiveFrame+analyzePose med 80.91ms p95 81.43ms  95.79%
    captureSerialize = 残差+stringify                 med 5.46ms p95 5.49ms  6.46%  (残差 2.85ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1492 samples/s · 包体 461.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 611.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.37ms/刷新 — 估算非实测
  内存: churn med 28.4MB p95 29.3MB /rep · post-gc heap 21→21→21→21→21→21→21MB

=== k5-d2 @240fps · 486 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=3402):
    frameAtCompiled      med 5.6µs p95 18.1µs
    solveEffectiveFrame  med 611.7µs p95 1.05ms
    analyzePose          med 29.1µs p95 71.1µs
    buildModel           med 16.9µs p95 43.3µs  (compat 交叉校验 n=490)
    frameFromModel       med 6.1µs p95 17.4µs  (compat 交叉校验 n=490)
    frameAt              med 14.1µs p95 27.6µs  (compat 交叉校验 n=490)
    samplePose           med 13.1µs p95 24.9µs  (compat 交叉校验 n=490)
  每rep (n=7):
    compileMotion        med 39.8µs p95 96.6µs
    solveWorkshop        med 325.30ms p95 479.30ms
    stringify            med 9.28ms p95 11.69ms
    probeFrames          med 330.70ms p95 418.30ms
    analyzeProbeFrames   med 6.95ms p95 12.58ms
    probeDocument        med 394.10ms p95 482.80ms
  roll-up (占 solveWorkshop median 325.30ms 的份额):
    compile          = compileMotion（每rep一次）     med 39.8µs p95 96.6µs  0.01223%
    sample           = frameAtCompiled                med 2.83ms p95 6.51ms  0.8684%
    solve            = solveEffectiveFrame+analyzePose med 312.70ms p95 461.10ms  96.13%
    captureSerialize = 残差+stringify                 med 19.01ms p95 21.42ms  5.844%  (残差 9.73ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1494 samples/s · 包体 1823KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 617.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.74ms/刷新 — 估算非实测
  内存: churn med 35.0MB p95 39.6MB /rep · post-gc heap 27→27→27→27→27→27→27MB

=== k5-d5 @40fps · 206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=1442):
    frameAtCompiled      med 5.3µs p95 8.4µs
    solveEffectiveFrame  med 603.3µs p95 668.4µs
    analyzePose          med 28.1µs p95 40.1µs
    buildModel           med 8.4µs p95 15.6µs  (compat 交叉校验 n=483)
    frameFromModel       med 5.5µs p95 8.5µs  (compat 交叉校验 n=483)
    frameAt              med 11.7µs p95 13.6µs  (compat 交叉校验 n=483)
    samplePose           med 11.5µs p95 12.8µs  (compat 交叉校验 n=483)
  每rep (n=7):
    compileMotion        med 31.0µs p95 44.9µs
    solveWorkshop        med 138.20ms p95 145.70ms
    stringify            med 3.86ms p95 4.26ms
    probeFrames          med 136.40ms p95 177.30ms
    analyzeProbeFrames   med 3.42ms p95 6.00ms
    probeDocument        med 139.30ms p95 149.90ms
  roll-up (占 solveWorkshop median 138.20ms 的份额):
    compile          = compileMotion（每rep一次）     med 31.0µs p95 44.9µs  0.02244%
    sample           = frameAtCompiled                med 1.15ms p95 1.24ms  0.8345%
    solve            = solveEffectiveFrame+analyzePose med 131.40ms p95 136.50ms  95.1%
    captureSerialize = 残差+stringify                 med 9.45ms p95 9.85ms  6.839%  (残差 5.59ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1491 samples/s · 包体 759.5KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 608.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.17ms/刷新 — 估算非实测
  内存: churn med 28.0MB p95 37.5MB /rep · post-gc heap 22→22→22→22→22→22→22MB

=== k5-d5 @60fps · 306 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=2142):
    frameAtCompiled      med 5.2µs p95 11.1µs
    solveEffectiveFrame  med 604.4µs p95 715.8µs
    analyzePose          med 28.2µs p95 45.7µs
    buildModel           med 12.5µs p95 27.2µs  (compat 交叉校验 n=539)
    frameFromModel       med 5.5µs p95 11.9µs  (compat 交叉校验 n=539)
    frameAt              med 14.2µs p95 20.9µs  (compat 交叉校验 n=539)
    samplePose           med 13.5µs p95 20.0µs  (compat 交叉校验 n=539)
  每rep (n=7):
    compileMotion        med 32.4µs p95 63.9µs
    solveWorkshop        med 203.10ms p95 217.80ms
    stringify            med 2.35ms p95 2.49ms
    probeFrames          med 203.70ms p95 293.90ms
    analyzeProbeFrames   med 5.00ms p95 7.65ms
    probeDocument        med 208.60ms p95 297.40ms
  roll-up (占 solveWorkshop median 203.10ms 的份额):
    compile          = compileMotion（每rep一次）     med 32.4µs p95 63.9µs  0.01593%
    sample           = frameAtCompiled                med 1.73ms p95 2.20ms  0.8536%
    solve            = solveEffectiveFrame+analyzePose med 196.20ms p95 217.90ms  96.58%
    captureSerialize = 残差+stringify                 med 7.53ms p95 7.66ms  3.706%  (残差 5.17ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1506 samples/s · 包体 1138KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 609.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.23ms/刷新 — 估算非实测
  内存: churn med 34.0MB p95 36.1MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k5-d5 @240fps · 1206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=8442):
    frameAtCompiled      med 5.3µs p95 15.9µs
    solveEffectiveFrame  med 602.7µs p95 895.1µs
    analyzePose          med 28.0µs p95 60.9µs
    buildModel           med 20.3µs p95 37.7µs  (compat 交叉校验 n=469)
    frameFromModel       med 6.1µs p95 14.1µs  (compat 交叉校验 n=469)
    frameAt              med 13.9µs p95 23.0µs  (compat 交叉校验 n=469)
    samplePose           med 12.9µs p95 16.6µs  (compat 交叉校验 n=469)
  每rep (n=7):
    compileMotion        med 45.8µs p95 49.7µs
    solveWorkshop        med 852.00ms p95 894.30ms
    stringify            med 8.21ms p95 22.38ms
    probeFrames          med 832.10ms p95 1065.00ms
    analyzeProbeFrames   med 14.05ms p95 30.00ms
    probeDocument        med 885.30ms p95 1023.00ms
  roll-up (占 solveWorkshop median 852.00ms 的份额):
    compile          = compileMotion（每rep一次）     med 45.8µs p95 49.7µs  0.005372%
    sample           = frameAtCompiled                med 8.07ms p95 9.23ms  0.9468%
    solve            = solveEffectiveFrame+analyzePose med 813.30ms p95 846.00ms  95.46%
    captureSerialize = 残差+stringify                 med 38.81ms p95 52.97ms  4.555%  (残差 30.59ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1415 samples/s · 包体 4526KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 608.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.13ms/刷新 — 估算非实测
  内存: churn med 43.3MB p95 54.0MB /rep · post-gc heap 46→38→38→38→38→38→38MB

=== k20-d2 @40fps · 101 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=707):
    frameAtCompiled      med 6.1µs p95 12.7µs
    solveEffectiveFrame  med 603.7µs p95 658.1µs
    analyzePose          med 28.9µs p95 39.0µs
    buildModel           med 23.7µs p95 33.5µs  (compat 交叉校验 n=707)
    frameFromModel       med 6.5µs p95 13.5µs  (compat 交叉校验 n=707)
    frameAt              med 27.6µs p95 37.6µs  (compat 交叉校验 n=707)
    samplePose           med 27.1µs p95 37.3µs  (compat 交叉校验 n=707)
  每rep (n=7):
    compileMotion        med 89.7µs p95 111.4µs
    solveWorkshop        med 69.27ms p95 74.84ms
    stringify            med 1.91ms p95 2.28ms
    probeFrames          med 55.85ms p95 56.84ms
    analyzeProbeFrames   med 1.73ms p95 1.92ms
    probeDocument        med 56.50ms p95 65.94ms
  roll-up (占 solveWorkshop median 69.27ms 的份额):
    compile          = compileMotion（每rep一次）     med 89.7µs p95 111.4µs  0.1295%
    sample           = frameAtCompiled                med 620.8µs p95 1.10ms  0.8962%
    solve            = solveEffectiveFrame+analyzePose med 64.81ms p95 65.26ms  93.56%
    captureSerialize = 残差+stringify                 med 5.66ms p95 6.03ms  8.167%  (残差 3.75ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1458 samples/s · 包体 311.9KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 609.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.24ms/刷新 — 估算非实测
  内存: churn med 10.7MB p95 64.8MB /rep · post-gc heap 21→21→21→20→20→20→20MB

=== k20-d2 @60fps · 141 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=987):
    frameAtCompiled      med 11.6µs p95 14.4µs
    solveEffectiveFrame  med 603.0µs p95 690.9µs
    analyzePose          med 28.6µs p95 41.8µs
    buildModel           med 31.1µs p95 58.5µs  (compat 交叉校验 n=497)
    frameFromModel       med 12.2µs p95 15.8µs  (compat 交叉校验 n=497)
    frameAt              med 36.5µs p95 59.6µs  (compat 交叉校验 n=497)
    samplePose           med 35.6µs p95 57.3µs  (compat 交叉校验 n=497)
  每rep (n=7):
    compileMotion        med 91.7µs p95 170.1µs
    solveWorkshop        med 94.95ms p95 96.53ms
    stringify            med 2.48ms p95 3.00ms
    probeFrames          med 82.47ms p95 107.70ms
    analyzeProbeFrames   med 2.43ms p95 3.90ms
    probeDocument        med 84.66ms p95 94.33ms
  roll-up (占 solveWorkshop median 94.95ms 的份额):
    compile          = compileMotion（每rep一次）     med 91.7µs p95 170.1µs  0.09656%
    sample           = frameAtCompiled                med 1.61ms p95 1.85ms  1.701%
    solve            = solveEffectiveFrame+analyzePose med 90.78ms p95 94.90ms  95.6%
    captureSerialize = 残差+stringify                 med 4.94ms p95 5.46ms  5.207%  (残差 2.47ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1485 samples/s · 包体 464KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 614.5µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.56ms/刷新 — 估算非实测
  内存: churn med 33.0MB p95 41.6MB /rep · post-gc heap 22→21→21→21→21→22→21MB

=== k20-d2 @240fps · 501 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=3507):
    frameAtCompiled      med 5.9µs p95 13.7µs
    solveEffectiveFrame  med 599.4µs p95 804.7µs
    analyzePose          med 28.0µs p95 52.0µs
    buildModel           med 39.9µs p95 84.7µs  (compat 交叉校验 n=504)
    frameFromModel       med 6.5µs p95 13.3µs  (compat 交叉校验 n=504)
    frameAt              med 31.6µs p95 59.8µs  (compat 交叉校验 n=504)
    samplePose           med 30.2µs p95 56.5µs  (compat 交叉校验 n=504)
  每rep (n=7):
    compileMotion        med 115.9µs p95 204.5µs
    solveWorkshop        med 330.90ms p95 393.50ms
    stringify            med 9.32ms p95 9.88ms
    probeFrames          med 326.70ms p95 331.40ms
    analyzeProbeFrames   med 7.64ms p95 9.31ms
    probeDocument        med 332.40ms p95 439.40ms
  roll-up (占 solveWorkshop median 330.90ms 的份额):
    compile          = compileMotion（每rep一次）     med 115.9µs p95 204.5µs  0.03502%
    sample           = frameAtCompiled                med 3.36ms p95 4.35ms  1.014%
    solve            = solveEffectiveFrame+analyzePose med 321.30ms p95 353.70ms  97.09%
    captureSerialize = 残差+stringify                 med 15.48ms p95 16.04ms  4.676%  (残差 6.16ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1514 samples/s · 包体 1828KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 605.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.95ms/刷新 — 估算非实测
  内存: churn med 39.2MB p95 48.0MB /rep · post-gc heap 27→27→27→27→27→27→30MB

=== k20-d5 @40fps · 221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=1547):
    frameAtCompiled      med 6.1µs p95 16.3µs
    solveEffectiveFrame  med 600.8µs p95 925.1µs
    analyzePose          med 28.3µs p95 64.3µs
    buildModel           med 26.7µs p95 67.0µs  (compat 交叉校验 n=518)
    frameFromModel       med 6.6µs p95 18.6µs  (compat 交叉校验 n=518)
    frameAt              med 28.4µs p95 52.8µs  (compat 交叉校验 n=518)
    samplePose           med 27.2µs p95 48.9µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 92.2µs p95 162.5µs
    solveWorkshop        med 146.90ms p95 166.20ms
    stringify            med 4.01ms p95 4.67ms
    probeFrames          med 136.30ms p95 183.30ms
    analyzeProbeFrames   med 3.63ms p95 3.89ms
    probeDocument        med 138.60ms p95 176.90ms
  roll-up (占 solveWorkshop median 146.90ms 的份额):
    compile          = compileMotion（每rep一次）     med 92.2µs p95 162.5µs  0.06273%
    sample           = frameAtCompiled                med 1.45ms p95 2.29ms  0.9897%
    solve            = solveEffectiveFrame+analyzePose med 140.00ms p95 171.70ms  95.29%
    captureSerialize = 残差+stringify                 med 9.38ms p95 10.04ms  6.385%  (残差 5.37ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1504 samples/s · 包体 765.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 607.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.06ms/刷新 — 估算非实测
  内存: churn med 28.7MB p95 42.2MB /rep · post-gc heap 23→23→23→22→22→22→22MB

=== k20-d5 @60fps · 321 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=2247):
    frameAtCompiled      med 6.1µs p95 10.8µs
    solveEffectiveFrame  med 600.2µs p95 661.8µs
    analyzePose          med 28.0µs p95 40.1µs
    buildModel           med 31.1µs p95 49.8µs  (compat 交叉校验 n=455)
    frameFromModel       med 6.8µs p95 12.1µs  (compat 交叉校验 n=455)
    frameAt              med 30.7µs p95 40.7µs  (compat 交叉校验 n=455)
    samplePose           med 29.8µs p95 39.5µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 93.9µs p95 174.1µs
    solveWorkshop        med 212.40ms p95 323.70ms
    stringify            med 2.83ms p95 6.02ms
    probeFrames          med 258.50ms p95 312.70ms
    analyzeProbeFrames   med 5.33ms p95 10.65ms
    probeDocument        med 208.10ms p95 289.00ms
  roll-up (占 solveWorkshop median 212.40ms 的份额):
    compile          = compileMotion（每rep一次）     med 93.9µs p95 174.1µs  0.04422%
    sample           = frameAtCompiled                med 2.26ms p95 2.44ms  1.062%
    solve            = solveEffectiveFrame+analyzePose med 204.60ms p95 205.80ms  96.31%
    captureSerialize = 残差+stringify                 med 8.31ms p95 11.50ms  3.914%  (残差 5.48ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1511 samples/s · 包体 1146KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 606.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.02ms/刷新 — 估算非实测
  内存: churn med 37.9MB p95 48.2MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5 @240fps · 1221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=8547):
    frameAtCompiled      med 5.5µs p95 16.9µs
    solveEffectiveFrame  med 603.0µs p95 992.8µs
    analyzePose          med 28.1µs p95 67.7µs
    buildModel           med 42.8µs p95 78.5µs  (compat 交叉校验 n=455)
    frameFromModel       med 6.3µs p95 15.9µs  (compat 交叉校验 n=455)
    frameAt              med 31.3µs p95 58.7µs  (compat 交叉校验 n=455)
    samplePose           med 30.1µs p95 56.4µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 105.4µs p95 176.0µs
    solveWorkshop        med 921.60ms p95 1129.00ms
    stringify            med 9.14ms p95 14.01ms
    probeFrames          med 832.00ms p95 964.20ms
    analyzeProbeFrames   med 14.92ms p95 25.56ms
    probeDocument        med 872.50ms p95 995.60ms
  roll-up (占 solveWorkshop median 921.60ms 的份额):
    compile          = compileMotion（每rep一次）     med 105.4µs p95 176.0µs  0.01144%
    sample           = frameAtCompiled                med 9.03ms p95 11.58ms  0.9801%
    solve            = solveEffectiveFrame+analyzePose med 849.20ms p95 953.30ms  92.14%
    captureSerialize = 残差+stringify                 med 72.42ms p95 77.30ms  7.858%  (残差 63.28ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1325 samples/s · 包体 4556KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 608.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.15ms/刷新 — 估算非实测
  内存: churn med 44.2MB p95 91.1MB /rep · post-gc heap 38→38→38→38→38→38→38MB

=== k20-d5-nib @40fps · 221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=1547):
    frameAtCompiled      med 1.1µs p95 3.6µs
    solveEffectiveFrame  med 602.0µs p95 784.4µs
    analyzePose          med 28.2µs p95 51.9µs
    buildModel           med 26.8µs p95 52.5µs  (compat 交叉校验 n=518)
    frameFromModel       med 1.4µs p95 5.0µs  (compat 交叉校验 n=518)
    frameAt              med 23.3µs p95 40.6µs  (compat 交叉校验 n=518)
    samplePose           med 29.3µs p95 52.4µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 91.9µs p95 184.5µs
    solveWorkshop        med 144.80ms p95 167.80ms
    stringify            med 4.06ms p95 5.77ms
    probeFrames          med 134.70ms p95 213.30ms
    analyzeProbeFrames   med 3.49ms p95 5.71ms
    probeDocument        med 157.50ms p95 183.30ms
  roll-up (占 solveWorkshop median 144.80ms 的份额):
    compile          = compileMotion（每rep一次）     med 91.9µs p95 184.5µs  0.06351%
    sample           = frameAtCompiled                med 277.4µs p95 490.9µs  0.1916%
    solve            = solveEffectiveFrame+analyzePose med 141.00ms p95 168.80ms  97.41%
    captureSerialize = 残差+stringify                 med 7.45ms p95 9.15ms  5.146%  (残差 3.39ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1527 samples/s · 包体 763.1KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 603.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.80ms/刷新 — 估算非实测
  内存: churn med 20.6MB p95 21.3MB /rep · post-gc heap 23→23→22→22→22→22→22MB

=== k20-d5-nib @60fps · 321 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=2247):
    frameAtCompiled      med 1.3µs p95 7.0µs
    solveEffectiveFrame  med 609.9µs p95 1.13ms
    analyzePose          med 29.1µs p95 75.2µs
    buildModel           med 38.3µs p95 102.8µs  (compat 交叉校验 n=455)
    frameFromModel       med 1.7µs p95 8.9µs  (compat 交叉校验 n=455)
    frameAt              med 29.0µs p95 63.8µs  (compat 交叉校验 n=455)
    samplePose           med 57.7µs p95 123.1µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 99.4µs p95 181.6µs
    solveWorkshop        med 209.00ms p95 210.30ms
    stringify            med 2.33ms p95 2.47ms
    probeFrames          med 201.30ms p95 303.60ms
    analyzeProbeFrames   med 5.18ms p95 5.24ms
    probeDocument        med 204.70ms p95 214.10ms
  roll-up (占 solveWorkshop median 209.00ms 的份额):
    compile          = compileMotion（每rep一次）     med 99.4µs p95 181.6µs  0.04757%
    sample           = frameAtCompiled                med 473.1µs p95 1.49ms  0.2264%
    solve            = solveEffectiveFrame+analyzePose med 206.70ms p95 311.20ms  98.91%
    captureSerialize = 残差+stringify                 med 4.04ms p95 4.18ms  1.932%  (残差 1.71ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1536 samples/s · 包体 1143KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 611.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.34ms/刷新 — 估算非实测
  内存: churn med 26.7MB p95 27.7MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5-nib @240fps · 1221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=8547):
    frameAtCompiled      med 1.1µs p95 5.5µs
    solveEffectiveFrame  med 603.0µs p95 973.7µs
    analyzePose          med 27.8µs p95 65.1µs
    buildModel           med 44.2µs p95 79.3µs  (compat 交叉校验 n=455)
    frameFromModel       med 2.0µs p95 6.0µs  (compat 交叉校验 n=455)
    frameAt              med 27.0µs p95 48.2µs  (compat 交叉校验 n=455)
    samplePose           med 49.8µs p95 87.1µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 104.8µs p95 172.2µs
    solveWorkshop        med 859.40ms p95 1107.00ms
    stringify            med 7.70ms p95 33.24ms
    probeFrames          med 807.60ms p95 866.00ms
    analyzeProbeFrames   med 13.50ms p95 17.98ms
    probeDocument        med 878.30ms p95 947.60ms
  roll-up (占 solveWorkshop median 859.40ms 的份额):
    compile          = compileMotion（每rep一次）     med 104.8µs p95 172.2µs  0.01219%
    sample           = frameAtCompiled                med 1.84ms p95 4.04ms  0.2139%
    solve            = solveEffectiveFrame+analyzePose med 797.60ms p95 1007.00ms  92.81%
    captureSerialize = 残差+stringify                 med 67.59ms p95 93.14ms  7.864%  (残差 59.89ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1421 samples/s · 包体 4543KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 604.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 39.87ms/刷新 — 估算非实测
  内存: churn med 60.3MB p95 69.3MB /rep · post-gc heap 37→37→37→37→37→37→37MB

=== k100-d2 @40fps · 181 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1267):
    frameAtCompiled      med 6.7µs p95 13.9µs
    solveEffectiveFrame  med 606.8µs p95 956.4µs
    analyzePose          med 29.1µs p95 64.6µs
    buildModel           med 106.5µs p95 242.0µs  (compat 交叉校验 n=637)
    frameFromModel       med 7.2µs p95 18.1µs  (compat 交叉校验 n=637)
    frameAt              med 105.6µs p95 209.4µs  (compat 交叉校验 n=637)
    samplePose           med 103.8µs p95 197.1µs  (compat 交叉校验 n=637)
  每rep (n=7):
    compileMotion        med 421.3µs p95 676.1µs
    solveWorkshop        med 120.30ms p95 141.90ms
    stringify            med 1.98ms p95 2.25ms
    probeFrames          med 55.24ms p95 56.91ms
    analyzeProbeFrames   med 1.97ms p95 2.13ms
    probeDocument        med 57.22ms p95 79.05ms
  roll-up (占 solveWorkshop median 120.30ms 的份额):
    compile          = compileMotion（每rep一次）     med 421.3µs p95 676.1µs  0.3502%
    sample           = frameAtCompiled                med 1.40ms p95 1.62ms  1.163%
    solve            = solveEffectiveFrame+analyzePose med 121.20ms p95 133.30ms  100.7%
    captureSerialize = 残差+stringify                 med -738.9µs p95 -469.3µs  -0.6142%  (残差 -2.72ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1505 samples/s · 包体 315.4KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 613.5µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.49ms/刷新 — 估算非实测
  内存: churn med 20.1MB p95 31.5MB /rep · post-gc heap 20→21→21→20→20→20→20MB

=== k100-d2 @60fps · 221 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1547):
    frameAtCompiled      med 7.2µs p95 15.4µs
    solveEffectiveFrame  med 606.0µs p95 711.1µs
    analyzePose          med 28.3µs p95 42.4µs
    buildModel           med 111.5µs p95 225.5µs  (compat 交叉校验 n=518)
    frameFromModel       med 8.2µs p95 19.0µs  (compat 交叉校验 n=518)
    frameAt              med 107.4µs p95 227.9µs  (compat 交叉校验 n=518)
    samplePose           med 105.0µs p95 226.5µs  (compat 交叉校验 n=518)
  每rep (n=7):
    compileMotion        med 419.3µs p95 825.9µs
    solveWorkshop        med 148.00ms p95 202.60ms
    stringify            med 2.63ms p95 2.73ms
    probeFrames          med 82.85ms p95 108.50ms
    analyzeProbeFrames   med 2.51ms p95 5.03ms
    probeDocument        med 84.90ms p95 122.30ms
  roll-up (占 solveWorkshop median 148.00ms 的份额):
    compile          = compileMotion（每rep一次）     med 419.3µs p95 825.9µs  0.2832%
    sample           = frameAtCompiled                med 1.90ms p95 3.18ms  1.281%
    solve            = solveEffectiveFrame+analyzePose med 143.30ms p95 154.70ms  96.79%
    captureSerialize = 残差+stringify                 med 5.07ms p95 5.17ms  3.422%  (残差 2.43ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1493 samples/s · 包体 467.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 613.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.47ms/刷新 — 估算非实测
  内存: churn med 49.1MB p95 60.4MB /rep · post-gc heap 21→21→21→21→21→20→20MB

=== k100-d2 @240fps · 581 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=4067):
    frameAtCompiled      med 6.2µs p95 17.4µs
    solveEffectiveFrame  med 602.0µs p95 963.7µs
    analyzePose          med 28.0µs p95 64.8µs
    buildModel           med 131.9µs p95 277.8µs  (compat 交叉校验 n=455)
    frameFromModel       med 7.8µs p95 21.4µs  (compat 交叉校验 n=455)
    frameAt              med 112.7µs p95 243.7µs  (compat 交叉校验 n=455)
    samplePose           med 106.9µs p95 231.1µs  (compat 交叉校验 n=455)
  每rep (n=7):
    compileMotion        med 434.4µs p95 603.2µs
    solveWorkshop        med 467.90ms p95 546.30ms
    stringify            med 8.80ms p95 9.96ms
    probeFrames          med 326.90ms p95 413.00ms
    analyzeProbeFrames   med 7.96ms p95 11.16ms
    probeDocument        med 351.30ms p95 486.10ms
  roll-up (占 solveWorkshop median 467.90ms 的份额):
    compile          = compileMotion（每rep一次）     med 434.4µs p95 603.2µs  0.09284%
    sample           = frameAtCompiled                med 3.79ms p95 7.99ms  0.8102%
    solve            = solveEffectiveFrame+analyzePose med 367.60ms p95 499.60ms  78.56%
    captureSerialize = 残差+stringify                 med 104.90ms p95 106.00ms  22.41%  (残差 96.07ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1242 samples/s · 包体 1827KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 608.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.14ms/刷新 — 估算非实测
  内存: churn med 59.3MB p95 65.8MB /rep · post-gc heap 26→26→26→26→26→26→26MB

=== k100-d5 @40fps · 301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2107):
    frameAtCompiled      med 6.3µs p95 9.0µs
    solveEffectiveFrame  med 601.1µs p95 666.3µs
    analyzePose          med 27.9µs p95 39.7µs
    buildModel           med 111.3µs p95 145.2µs  (compat 交叉校验 n=532)
    frameFromModel       med 7.3µs p95 10.8µs  (compat 交叉校验 n=532)
    frameAt              med 105.9µs p95 163.4µs  (compat 交叉校验 n=532)
    samplePose           med 104.2µs p95 139.4µs  (compat 交叉校验 n=532)
  每rep (n=7):
    compileMotion        med 412.0µs p95 622.6µs
    solveWorkshop        med 199.10ms p95 310.50ms
    stringify            med 2.04ms p95 4.45ms
    probeFrames          med 134.80ms p95 164.70ms
    analyzeProbeFrames   med 4.02ms p95 7.57ms
    probeDocument        med 139.20ms p95 204.50ms
  roll-up (占 solveWorkshop median 199.10ms 的份额):
    compile          = compileMotion（每rep一次）     med 412.0µs p95 622.6µs  0.2069%
    sample           = frameAtCompiled                med 1.95ms p95 2.20ms  0.9789%
    solve            = solveEffectiveFrame+analyzePose med 192.20ms p95 195.40ms  96.53%
    captureSerialize = 残差+stringify                 med 6.58ms p95 9.00ms  3.307%  (残差 4.55ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1512 samples/s · 包体 767.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 607.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.09ms/刷新 — 估算非实测
  内存: churn med 47.1MB p95 61.6MB /rep · post-gc heap 22→22→23→22→22→22→22MB

=== k100-d5 @60fps · 401 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2807):
    frameAtCompiled      med 6.7µs p95 18.0µs
    solveEffectiveFrame  med 603.2µs p95 987.0µs
    analyzePose          med 28.0µs p95 68.5µs
    buildModel           med 124.4µs p95 279.3µs  (compat 交叉校验 n=469)
    frameFromModel       med 8.5µs p95 20.5µs  (compat 交叉校验 n=469)
    frameAt              med 110.8µs p95 249.5µs  (compat 交叉校验 n=469)
    samplePose           med 107.0µs p95 246.4µs  (compat 交叉校验 n=469)
  每rep (n=7):
    compileMotion        med 428.2µs p95 725.4µs
    solveWorkshop        med 270.30ms p95 285.70ms
    stringify            med 3.10ms p95 6.71ms
    probeFrames          med 204.20ms p95 220.40ms
    analyzeProbeFrames   med 5.33ms p95 5.49ms
    probeDocument        med 207.80ms p95 262.10ms
  roll-up (占 solveWorkshop median 270.30ms 的份额):
    compile          = compileMotion（每rep一次）     med 428.2µs p95 725.4µs  0.1584%
    sample           = frameAtCompiled                med 2.89ms p95 6.03ms  1.069%
    solve            = solveEffectiveFrame+analyzePose med 256.90ms p95 379.50ms  95.06%
    captureSerialize = 残差+stringify                 med 13.14ms p95 16.76ms  4.863%  (残差 10.05ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1484 samples/s · 包体 1147KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 609.9µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.25ms/刷新 — 估算非实测
  内存: churn med 52.4MB p95 60.7MB /rep · post-gc heap 23→23→23→23→23→23→23MB

=== k100-d5 @240fps · 1301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=9107):
    frameAtCompiled      med 6.0µs p95 19.0µs
    solveEffectiveFrame  med 604.6µs p95 1.03ms
    analyzePose          med 27.9µs p95 68.8µs
    buildModel           med 142.4µs p95 308.9µs  (compat 交叉校验 n=462)
    frameFromModel       med 8.6µs p95 21.9µs  (compat 交叉校验 n=462)
    frameAt              med 114.2µs p95 282.4µs  (compat 交叉校验 n=462)
    samplePose           med 108.3µs p95 247.3µs  (compat 交叉校验 n=462)
  每rep (n=7):
    compileMotion        med 414.6µs p95 751.6µs
    solveWorkshop        med 984.40ms p95 1140.00ms
    stringify            med 8.60ms p95 10.17ms
    probeFrames          med 932.60ms p95 1028.00ms
    analyzeProbeFrames   med 21.22ms p95 33.30ms
    probeDocument        med 965.00ms p95 1208.00ms
  roll-up (占 solveWorkshop median 984.40ms 的份额):
    compile          = compileMotion（每rep一次）     med 414.6µs p95 751.6µs  0.04212%
    sample           = frameAtCompiled                med 10.10ms p95 15.71ms  1.026%
    solve            = solveEffectiveFrame+analyzePose med 880.60ms p95 1063.00ms  89.46%
    captureSerialize = 残差+stringify                 med 101.80ms p95 103.40ms  10.35%  (残差 93.25ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1322 samples/s · 包体 4547KB
  derived.workshop 拖拽/洋葱皮估算: frameAtCompiled+solve 610.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 40.30ms/刷新 — 估算非实测
  内存: churn med 66.2MB p95 77.7MB /rep · post-gc heap 38→38→37→37→37→38→37MB

=== hotspots（全场景份额排序）===
  1. solve              93.9%
  2. captureSerialize   6.648%
  3. sample             0.8698%
  4. compile            0.05316%
  render             未测量（浏览器侧另计）

=== 基线对比 2026-10-18T05:29:41.340Z → 2026-10-18T05:55:44.250Z ===
⚠ 仅同机同环境可比：不同机器/负载的绝对数字不构成加速证据；median 噪声按 ±5% 计、p95 更噪。
  [default-5k@40]
    buildModel           med  +18.8%  p95  +63.8%
    frameFromModel       med   +6.6%  p95  +26.8%
    solveEffectiveFrame  med   -4.4%  p95  -16.2%
    analyzePose          med   -3.0%  p95   +9.8%
    solveWorkshop        med   -5.5%  p95   -6.9%
    stringify            med   +9.3%  p95   +4.2%
    probeFrames          med   -5.6%  p95   -4.8%
    analyzeProbeFrames   med   -0.2%  p95   -0.2%
    probeDocument        med   -8.0%  p95   -7.9%
    rollup.compile       med  -87.4%  p95  -79.1%
    rollup.sample        med   -7.7%  p95  +19.2%
    rollup.solve         med   -5.4%  p95   -6.4%
    rollup.captureSerialize med  +12.1%  p95  +10.3%
  [default-5k@60]
    buildModel           med  +34.6%  p95  +83.1%
    frameFromModel       med   +6.8%  p95  +11.8%
    solveEffectiveFrame  med   -4.1%  p95   -8.5%
    analyzePose          med   -1.8%  p95   -4.2%
    solveWorkshop        med   -6.1%  p95  -12.4%
    stringify            med +128.7%  p95   -5.7%
    probeFrames          med   -4.9%  p95  -13.5%
    analyzeProbeFrames   med   -1.3%  p95   +5.8%
    probeDocument        med   -5.3%  p95   -7.6%
    rollup.compile       med  -93.5%  p95  -88.8%
    rollup.sample        med   -5.3%  p95   -2.4%
    rollup.solve         med   -5.7%  p95   -3.1%
    rollup.captureSerialize med  +33.8%  p95   +5.5%
  [default-5k@240]
    buildModel           med  +72.0%  p95  +91.7%
    frameFromModel       med   +4.8%  p95  +24.4%
    solveEffectiveFrame  med   -4.2%  p95   -5.5%
    analyzePose          med   -2.4%  p95   +0.8%
    solveWorkshop        med   -2.7%  p95   -2.9%
    stringify            med   +1.7%  p95   +0.2%
    probeFrames          med   +0.0%  p95  +24.3%
    analyzeProbeFrames   med   +2.4%  p95  +99.9%
    probeDocument        med   +5.0%  p95  +35.1%
    rollup.compile       med  -97.7%  p95  -95.9%
    rollup.sample        med   +1.1%  p95   +3.8%
    rollup.solve         med   -4.5%  p95   -1.3%
    rollup.captureSerialize med  +49.1%  p95  +46.0%
  [forehand-49k@40]
    buildModel           med  +60.2%  p95 +152.4%
    frameFromModel       med  +10.6%  p95 +336.9%
    solveEffectiveFrame  med   -1.2%  p95  +64.7%
    analyzePose          med   +5.9%  p95  +93.8%
    solveWorkshop        med  -11.8%  p95  -13.7%
    stringify            med +160.1%  p95 +149.1%
    probeFrames          med  -11.3%  p95   -6.5%
    analyzeProbeFrames   med   +3.0%  p95   -4.7%
    probeDocument        med  -11.2%  p95  -12.5%
    rollup.compile       med  -98.2%  p95  -97.8%
    rollup.sample        med  -10.3%  p95 +295.9%
    rollup.solve         med   -2.0%  p95  +47.3%
    rollup.captureSerialize med   -3.32ms  p95   -3.14ms  (残差基数近零，按绝对差)
  [forehand-49k@60]
    buildModel           med  +17.5%  p95  +96.4%
    frameFromModel       med  +17.9%  p95  +93.3%
    solveEffectiveFrame  med   -3.9%  p95  +19.2%
    analyzePose          med   -4.2%  p95  +37.3%
    solveWorkshop        med  -11.7%  p95  -10.5%
    stringify            med   -0.1%  p95 +163.6%
    probeFrames          med  -10.5%  p95   +6.0%
    analyzeProbeFrames   med   -5.0%  p95  +72.8%
    probeDocument        med  -10.0%  p95   +5.5%
    rollup.compile       med  -98.9%  p95  -98.4%
    rollup.sample        med  +13.6%  p95  +48.8%
    rollup.solve         med   -3.7%  p95  +10.7%
    rollup.captureSerialize med   -4.51ms  p95   -0.24ms  (残差基数近零，按绝对差)
  [forehand-49k@240]
    buildModel           med  +35.6%  p95 +112.9%
    frameFromModel       med   +8.8%  p95  +61.7%
    solveEffectiveFrame  med   -3.9%  p95  +44.7%
    analyzePose          med   -4.4%  p95  +62.5%
    solveWorkshop        med   -7.9%  p95   -0.8%
    stringify            med   +2.5%  p95  +18.7%
    probeFrames          med  -10.7%  p95   -6.4%
    analyzeProbeFrames   med   +1.9%  p95  +14.9%
    probeDocument        med   +0.2%  p95   -2.3%
    rollup.compile       med  -99.7%  p95  -99.6%
    rollup.sample        med   +4.0%  p95  +69.8%
    rollup.solve         med   +1.6%  p95  +27.3%
    rollup.captureSerialize med  -22.85ms  p95  -20.91ms  (残差基数近零，按绝对差)
  [k5-d2@40]
    buildModel           med  +12.4%  p95  +95.5%
    frameFromModel       med   +7.2%  p95  +58.1%
    solveEffectiveFrame  med   -4.0%  p95   -6.2%
    analyzePose          med   -3.0%  p95   -4.6%
    solveWorkshop        med   -4.9%  p95  +50.5%
    stringify            med   +1.4%  p95   +9.4%
    probeFrames          med   -4.9%  p95  +35.0%
    analyzeProbeFrames   med   +0.9%  p95  +42.6%
    probeDocument        med   -5.2%  p95  +43.1%
    rollup.compile       med  -95.2%  p95  -92.2%
    rollup.sample        med   +4.3%  p95   -0.1%
    rollup.solve         med   -4.2%  p95   -4.3%
    rollup.captureSerialize med   +1.1%  p95   +4.9%
  [k5-d2@60]
    buildModel           med  +16.7%  p95  +88.7%
    frameFromModel       med  +17.0%  p95  +50.5%
    solveEffectiveFrame  med   -4.0%  p95   -8.0%
    analyzePose          med   -3.5%  p95  -10.1%
    solveWorkshop        med   -5.8%  p95  -20.3%
    stringify            med   +5.6%  p95   -0.4%
    probeFrames          med   -4.9%  p95  -10.8%
    analyzeProbeFrames   med   -8.8%  p95   -6.5%
    probeDocument        med   -5.3%  p95  -22.9%
    rollup.compile       med  -96.9%  p95  -94.6%
    rollup.sample        med   +9.8%  p95  +21.5%
    rollup.solve         med   -4.2%  p95   -8.7%
    rollup.captureSerialize med  -11.2%  p95  -13.2%
  [k5-d2@240]
    buildModel           med +123.7%  p95 +193.2%
    frameFromModel       med  +13.2%  p95  +81.2%
    solveEffectiveFrame  med   -3.1%  p95  +47.5%
    analyzePose          med   +0.3%  p95  +63.7%
    solveWorkshop        med   -4.4%  p95  +30.7%
    stringify            med   -0.6%  p95  +12.6%
    probeFrames          med   -4.0%  p95  +13.0%
    analyzeProbeFrames   med   +6.8%  p95  +64.4%
    probeDocument        med  +12.2%  p95  +32.0%
    rollup.compile       med  -99.0%  p95  -97.8%
    rollup.sample        med   -1.0%  p95 +124.1%
    rollup.solve         med   -4.6%  p95  +40.2%
    rollup.captureSerialize med   +3.84ms  p95   +5.20ms  (残差基数近零，按绝对差)
  [k5-d5@40]
    buildModel           med  +17.3%  p95   +8.3%
    frameFromModel       med   +5.5%  p95  -13.2%
    solveEffectiveFrame  med   -4.9%  p95   -9.0%
    analyzePose          med   -4.0%  p95  -10.0%
    solveWorkshop        med   -5.3%  p95   -0.7%
    stringify            med   -6.7%  p95   -1.0%
    probeFrames          med   -5.3%  p95  +21.7%
    analyzeProbeFrames   med   +0.9%  p95  +71.8%
    probeDocument        med   -5.4%  p95  -27.2%
    rollup.compile       med  -98.2%  p95  -97.6%
    rollup.sample        med   -1.5%  p95   +0.8%
    rollup.solve         med   -5.6%  p95   -4.5%
    rollup.captureSerialize med  +17.4%  p95  +20.0%
  [k5-d5@60]
    buildModel           med  +52.2%  p95  +87.1%
    frameFromModel       med   +4.2%  p95  +38.2%
    solveEffectiveFrame  med   -3.9%  p95   +2.6%
    analyzePose          med   -2.9%  p95   +9.8%
    solveWorkshop        med   -6.6%  p95   -5.8%
    stringify            med  -63.2%  p95  -64.3%
    probeFrames          med   -6.2%  p95  +32.5%
    analyzeProbeFrames   med   +7.2%  p95  +58.9%
    probeDocument        med   -6.5%  p95  +32.3%
    rollup.compile       med  -98.8%  p95  -98.1%
    rollup.sample        med   -0.8%  p95  +20.9%
    rollup.solve         med   -3.7%  p95   +5.7%
    rollup.captureSerialize med  -52.3%  p95  -53.1%
  [k5-d5@240]
    buildModel           med +166.6%  p95 +165.9%
    frameFromModel       med  +12.4%  p95  +58.0%
    solveEffectiveFrame  med   -4.3%  p95  +27.7%
    analyzePose          med   -4.1%  p95  +43.9%
    solveWorkshop        med   +0.9%  p95   +4.2%
    stringify            med  -64.6%  p95   -7.4%
    probeFrames          med   -2.7%  p95  +16.7%
    analyzeProbeFrames   med   -5.4%  p95  +61.8%
    probeDocument        med   +1.9%  p95  +16.3%
    rollup.compile       med  -99.6%  p95  -99.5%
    rollup.sample        med  +15.4%  p95  +26.6%
    rollup.solve         med   +0.8%  p95   +3.5%
    rollup.captureSerialize med  -11.3%  p95  +18.5%
  [k20-d2@40]
    buildModel           med  +12.5%  p95  +49.2%
    frameFromModel       med  +12.1%  p95  +34.9%
    solveEffectiveFrame  med   -4.1%  p95   -6.9%
    analyzePose          med   -2.3%  p95   -6.6%
    solveWorkshop        med   -8.2%  p95   -2.0%
    stringify            med   -8.6%  p95  -10.9%
    probeFrames          med   -7.4%  p95  -15.4%
    analyzeProbeFrames   med   +5.8%  p95   +3.9%
    probeDocument        med   -7.4%  p95   +3.7%
    rollup.compile       med  -95.9%  p95  -95.3%
    rollup.sample        med   +1.1%  p95  +19.3%
    rollup.solve         med   -4.6%  p95   -4.2%
    rollup.captureSerialize med  -17.5%  p95  -17.7%
  [k20-d2@60]
    buildModel           med  +39.9%  p95  +69.1%
    frameFromModel       med +106.5%  p95  +55.1%
    solveEffectiveFrame  med   -4.4%  p95   -9.4%
    analyzePose          med   -3.5%  p95  -12.6%
    solveWorkshop        med   -8.3%  p95   -8.5%
    stringify            med   -6.1%  p95   +0.1%
    probeFrames          med   -7.6%  p95  +19.3%
    analyzeProbeFrames   med   +1.0%  p95  +49.7%
    probeDocument        med   -7.8%  p95   +1.5%
    rollup.compile       med  -97.2%  p95  -95.8%
    rollup.sample        med  +85.2%  p95   -0.4%
    rollup.solve         med   -4.1%  p95  -16.1%
    rollup.captureSerialize med  -33.0%  p95  -29.4%
  [k20-d2@240]
    buildModel           med  +73.7%  p95 +158.4%
    frameFromModel       med  +10.8%  p95  +34.4%
    solveEffectiveFrame  med   -5.1%  p95  +11.4%
    analyzePose          med   -5.1%  p95  +20.5%
    solveWorkshop        med   -7.7%  p95   +7.7%
    stringify            med   -1.5%  p95   -5.4%
    probeFrames          med   -6.5%  p95  -25.5%
    analyzeProbeFrames   med   -1.7%  p95  +16.0%
    probeDocument        med   -6.9%  p95   -3.8%
    rollup.compile       med  -99.1%  p95  -98.4%
    rollup.sample        med   +3.3%  p95  +29.0%
    rollup.solve         med   -5.0%  p95   +3.5%
    rollup.captureSerialize med   +1.38ms  p95   +0.96ms  (残差基数近零，按绝对差)
  [k20-d5@40]
    buildModel           med  +18.7%  p95 +118.6%
    frameFromModel       med  +13.4%  p95  +95.5%
    solveEffectiveFrame  med   -4.2%  p95  +31.5%
    analyzePose          med   -4.1%  p95  +54.2%
    solveWorkshop        med   -8.2%  p95   -6.8%
    stringify            med +129.6%  p95  +15.6%
    probeFrames          med   -7.1%  p95  +21.9%
    analyzeProbeFrames   med   -0.4%  p95   +1.2%
    probeDocument        med   -7.2%  p95  +14.1%
    rollup.compile       med  -98.2%  p95  -97.1%
    rollup.sample        med   +5.8%  p95  +50.6%
    rollup.solve         med   -5.9%  p95  +11.7%
    rollup.captureSerialize med   +2.94ms  p95   +1.30ms  (残差基数近零，按绝对差)
  [k20-d5@60]
    buildModel           med  +36.6%  p95  +60.1%
    frameFromModel       med  +17.4%  p95  +26.9%
    solveEffectiveFrame  med   -4.1%  p95   -4.5%
    analyzePose          med   -4.5%  p95   -3.3%
    solveWorkshop        med   -7.8%  p95  +26.8%
    stringify            med  -56.1%  p95  -11.3%
    probeFrames          med  +18.1%  p95  +37.5%
    analyzeProbeFrames   med   +2.0%  p95 +100.9%
    probeDocument        med   -6.1%  p95  +25.9%
    rollup.compile       med  -98.8%  p95  -97.9%
    rollup.sample        med  +11.7%  p95  +13.7%
    rollup.solve         med   -3.8%  p95   -8.1%
    rollup.captureSerialize med  -42.8%  p95  -22.6%
  [k20-d5@240]
    buildModel           med  +88.7%  p95 +172.8%
    frameFromModel       med  +11.7%  p95  +91.0%
    solveEffectiveFrame  med   -3.0%  p95  +48.7%
    analyzePose          med   -2.0%  p95  +85.8%
    solveWorkshop        med   +8.3%  p95  +25.8%
    stringify            med  +10.3%  p95  +64.6%
    probeFrames          med   -2.7%  p95   +7.9%
    analyzeProbeFrames   med   +2.3%  p95  +29.4%
    probeDocument        med   +0.8%  p95   +8.4%
    rollup.compile       med  -99.6%  p95  -99.4%
    rollup.sample        med  +21.7%  p95  +49.9%
    rollup.solve         med   +5.3%  p95  +16.3%
    rollup.captureSerialize med  +56.61ms  p95  +61.26ms  (残差基数近零，按绝对差)
  [k20-d5-nib@40]
    buildModel           med  +20.3%  p95 +106.8%
    frameFromModel       med  +68.7%  p95 +287.2%
    solveEffectiveFrame  med   -3.2%  p95  +20.0%
    analyzePose          med   -1.1%  p95  +60.3%
    solveWorkshop        med   -6.8%  p95  -14.2%
    stringify            med +157.6%  p95 +200.8%
    probeFrames          med   -6.3%  p95  +40.3%
    analyzeProbeFrames   med   -0.0%  p95  +56.6%
    probeDocument        med   +8.7%  p95  +22.4%
    rollup.compile       med  -98.2%  p95  -96.5%
    rollup.sample        med  +45.5%  p95  +79.7%
    rollup.solve         med   -2.4%  p95  +15.5%
    rollup.captureSerialize med   +0.30ms  p95   +1.66ms  (残差基数近零，按绝对差)
  [k20-d5-nib@60]
    buildModel           med  +67.4%  p95 +201.3%
    frameFromModel       med +101.8%  p95 +452.9%
    solveEffectiveFrame  med   -2.4%  p95  +56.2%
    analyzePose          med   +0.2%  p95  +73.3%
    solveWorkshop        med   -7.4%  p95   -8.6%
    stringify            med  -61.2%  p95  -60.6%
    probeFrames          med   -6.8%  p95  +32.6%
    analyzeProbeFrames   med   +6.8%  p95   +3.7%
    probeDocument        med   -6.2%  p95   -4.9%
    rollup.compile       med  -98.8%  p95  -98.0%
    rollup.sample        med  +45.3%  p95 +292.9%
    rollup.solve         med   -5.1%  p95  +14.7%
    rollup.captureSerialize med   -1.49ms  p95   -1.60ms  (残差基数近零，按绝对差)
  [k20-d5-nib@240]
    buildModel           med  +92.4%  p95 +151.8%
    frameFromModel       med +136.8%  p95 +344.6%
    solveEffectiveFrame  med   -3.2%  p95  +42.0%
    analyzePose          med   -3.1%  p95  +59.9%
    solveWorkshop        med   -0.3%  p95  +25.9%
    stringify            med   +5.7%  p95 +321.8%
    probeFrames          med   -6.4%  p95   -4.9%
    analyzeProbeFrames   med   -2.7%  p95   +7.4%
    probeDocument        med   +0.5%  p95   +7.5%
    rollup.compile       med  -99.6%  p95  -99.4%
    rollup.sample        med  +63.5%  p95 +243.4%
    rollup.solve         med   -1.3%  p95  +23.4%
    rollup.captureSerialize med  +36.97ms  p95  +61.92ms  (残差基数近零，按绝对差)
  [k100-d2@40]
    buildModel           med   +8.6%  p95 +124.9%
    frameFromModel       med  +14.4%  p95 +122.1%
    solveEffectiveFrame  med   -3.4%  p95  +42.4%
    analyzePose          med   -1.8%  p95  +64.1%
    solveWorkshop        med  -17.3%  p95   -3.5%
    stringify            med   +1.7%  p95  +10.1%
    probeFrames          med  -14.1%  p95  -13.4%
    analyzeProbeFrames   med   +2.8%  p95   +0.0%
    probeDocument        med  -14.2%  p95   +9.7%
    rollup.compile       med  -97.7%  p95  -96.4%
    rollup.sample        med  +19.6%  p95  +32.0%
    rollup.solve         med   +0.8%  p95   +7.8%
    rollup.captureSerialize med -109.7%  p95 -106.1%
  [k100-d2@60]
    buildModel           med  +13.9%  p95 +113.9%
    frameFromModel       med  +31.9%  p95 +146.3%
    solveEffectiveFrame  med   -3.9%  p95   +7.3%
    analyzePose          med   -3.8%  p95  +26.9%
    solveWorkshop        med  -16.1%  p95  +11.4%
    stringify            med   +0.2%  p95   +1.9%
    probeFrames          med  -15.2%  p95   -5.5%
    analyzeProbeFrames   med   -3.4%  p95  +83.4%
    probeDocument        med  -14.2%  p95  +13.5%
    rollup.compile       med  -98.1%  p95  -96.3%
    rollup.sample        med  +32.4%  p95 +115.8%
    rollup.solve         med   -2.3%  p95   +4.0%
    rollup.captureSerialize med   -3.39ms  p95   -3.34ms  (残差基数近零，按绝对差)
  [k100-d2@240]
    buildModel           med  +33.8%  p95 +160.8%
    frameFromModel       med  +26.1%  p95 +165.2%
    solveEffectiveFrame  med   -3.9%  p95  +45.6%
    analyzePose          med   -4.3%  p95  +92.6%
    solveWorkshop        med   +2.8%  p95   +5.3%
    stringify            med +128.5%  p95 +137.6%
    probeFrames          med  -14.4%  p95  -14.3%
    analyzeProbeFrames   med   +0.5%  p95  +35.6%
    probeDocument        med   -9.7%  p95   +9.2%
    rollup.compile       med  -99.3%  p95  -99.0%
    rollup.sample        med   +2.0%  p95 +101.2%
    rollup.solve         med   -4.1%  p95  +27.4%
    rollup.captureSerialize med  +91.88ms  p95  +92.64ms  (残差基数近零，按绝对差)
  [k100-d5@40]
    buildModel           med  +13.1%  p95  +37.9%
    frameFromModel       med  +17.7%  p95  +42.2%
    solveEffectiveFrame  med   -3.9%  p95   +1.4%
    analyzePose          med   -4.7%  p95  +19.7%
    solveWorkshop        med  -16.8%  p95   +2.2%
    stringify            med  +13.9%  p95 +116.7%
    probeFrames          med  -15.4%  p95   -0.8%
    analyzeProbeFrames   med   +5.1%  p95  +88.2%
    probeDocument        med  -15.0%  p95  +23.7%
    rollup.compile       med  -98.6%  p95  -98.0%
    rollup.sample        med   +1.1%  p95  +10.8%
    rollup.solve         med   -3.1%  p95   -2.9%
    rollup.captureSerialize med   -3.81ms  p95   -1.66ms  (残差基数近零，按绝对差)
  [k100-d5@60]
    buildModel           med  +25.0%  p95 +129.9%
    frameFromModel       med  +31.3%  p95 +109.4%
    solveEffectiveFrame  med   -4.3%  p95  +34.0%
    analyzePose          med   -5.7%  p95  +60.5%
    solveWorkshop        med  -14.6%  p95  -14.0%
    stringify            med  +21.1%  p95 +146.7%
    probeFrames          med  -15.0%  p95  -11.2%
    analyzeProbeFrames   med   +0.4%  p95   +1.8%
    probeDocument        med  -14.9%  p95   +2.7%
    rollup.compile       med  -99.0%  p95  -98.4%
    rollup.sample        med   +6.4%  p95  +88.3%
    rollup.solve         med   -5.4%  p95  +15.3%
    rollup.captureSerialize med   +9.78ms  p95  +13.24ms  (残差基数近零，按绝对差)
  [k100-d5@240]
    buildModel           med  +43.5%  p95 +159.8%
    frameFromModel       med  +41.4%  p95 +134.3%
    solveEffectiveFrame  med   -3.2%  p95  +46.6%
    analyzePose          med   -4.5%  p95  +70.0%
    solveWorkshop        med   -5.9%  p95   +3.4%
    stringify            med   +0.4%  p95  +15.2%
    probeFrames          med   -5.8%  p95   +2.2%
    analyzeProbeFrames   med  +10.2%  p95  +59.8%
    probeDocument        med   -2.0%  p95  +16.3%
    rollup.compile       med  -99.7%  p95  -99.5%
    rollup.sample        med  +19.6%  p95  +50.0%
    rollup.solve         med   +1.6%  p95  +14.1%
    rollup.captureSerialize med  +57.71ms  p95  +59.05ms  (残差基数近零，按绝对差)
