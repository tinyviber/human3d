=== workshop-pipeline 性能基线 · 2026-10-18T05:29:41.340Z ===
env: node v25.8.1 darwin-x64 · Intel(R) Core(TM) i7-14700KF 28核 64GB · three 0.180.0 · tsx 4.23.15 · commit 542fbc3
cmd: node --import tsx --expose-gc scripts/bench-workshop.mts
params: seed 1 warmup 2 reps 7 gc available
口径: 全部为 µs · 阶段帧级分摊=compile(buildModel)/sample(frameFromModel)/solve(solveEffectiveFrame+analyzePose)/render(未测量) · captureSerialize=残差+stringify
    残差可为负（两段测量回路的中位噪声）；captureSerialize 含 stringify，四桶份额不必合计 100%

=== default-5k @40fps · 38 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=266):
    buildModel           med 9.1µs p95 22.9µs
    frameFromModel       med 5.8µs p95 15.4µs
    solveEffectiveFrame  med 643.4µs p95 826.0µs
    analyzePose          med 35.9µs p95 56.3µs
    frameAt              med 17.3µs p95 48.2µs  (交叉校验 n=266)
    samplePose           med 14.8µs p95 41.3µs  (交叉校验 n=266)
  每rep (n=7):
    solveWorkshop        med 28.58ms p95 29.36ms
    stringify            med 756.9µs p95 843.2µs
    probeFrames          med 24.77ms p95 25.43ms
    analyzeProbeFrames   med 672.1µs p95 736.5µs
    probeDocument        med 25.42ms p95 26.03ms
  roll-up (占 solveWorkshop median 28.58ms 的份额):
    compile          = buildModel                     med 393.8µs p95 731.8µs  1.378%
    sample           = frameFromModel                 med 226.6µs p95 510.8µs  0.7928%
    solve            = solveEffectiveFrame+analyzePose med 26.41ms p95 28.54ms  92.4%
    captureSerialize = 残差+stringify                 med 2.31ms p95 2.39ms  8.074%  (残差 1.55ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1330 samples/s · 包体 133.2KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 660.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.61ms/刷新 — 估算非实测
  内存: churn med 2.7MB p95 14.9MB /rep · post-gc heap 19→19→19→19→19→19→19MB

=== default-5k @60fps · 54 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=378):
    buildModel           med 9.7µs p95 13.7µs
    frameFromModel       med 5.4µs p95 11.2µs
    solveEffectiveFrame  med 632.2µs p95 752.8µs
    analyzePose          med 33.9µs p95 50.3µs
    frameAt              med 17.5µs p95 35.3µs  (交叉校验 n=378)
    samplePose           med 15.3µs p95 27.1µs  (交叉校验 n=378)
  每rep (n=7):
    solveWorkshop        med 40.07ms p95 44.08ms
    stringify            med 457.8µs p95 1.21ms
    probeFrames          med 35.45ms p95 39.34ms
    analyzeProbeFrames   med 915.1µs p95 936.6µs
    probeDocument        med 36.31ms p95 39.32ms
  roll-up (占 solveWorkshop median 40.07ms 的份额):
    compile          = buildModel                     med 574.7µs p95 661.3µs  1.434%
    sample           = frameFromModel                 med 293.0µs p95 575.8µs  0.7312%
    solve            = solveEffectiveFrame+analyzePose med 37.19ms p95 37.31ms  92.81%
    captureSerialize = 残差+stringify                 med 2.47ms p95 3.22ms  6.165%  (残差 2.01ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1348 samples/s · 包体 196.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 649.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.87ms/刷新 — 估算非实测
  内存: churn med 14.1MB p95 14.6MB /rep · post-gc heap 19→19→19→19→19→19→19MB

=== default-5k @240fps · 198 samples · 5 keys · 0.8s · defaultDocument ===
  每样本 (n=1386):
    buildModel           med 8.4µs p95 16.1µs
    frameFromModel       med 5.0µs p95 7.7µs
    solveEffectiveFrame  med 623.5µs p95 701.5µs
    analyzePose          med 31.6µs p95 45.2µs
    frameAt              med 14.1µs p95 26.2µs  (交叉校验 n=462)
    samplePose           med 12.4µs p95 16.0µs  (交叉校验 n=462)
  每rep (n=7):
    solveWorkshop        med 138.90ms p95 199.40ms
    stringify            med 4.38ms p95 4.79ms
    probeFrames          med 136.90ms p95 148.50ms
    analyzeProbeFrames   med 3.18ms p95 3.26ms
    probeDocument        med 139.40ms p95 142.90ms
  roll-up (占 solveWorkshop median 138.90ms 的份额):
    compile          = buildModel                     med 1.95ms p95 2.18ms  1.407%
    sample           = frameFromModel                 med 1.04ms p95 1.08ms  0.7466%
    solve            = solveEffectiveFrame+analyzePose med 132.00ms p95 132.60ms  95.03%
    captureSerialize = 残差+stringify                 med 8.28ms p95 8.70ms  5.963%  (残差 3.91ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1426 samples/s · 包体 760.6KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 637.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.08ms/刷新 — 估算非实测
  内存: churn med 9.3MB p95 13.0MB /rep · post-gc heap 22→22→23→22→22→22→21MB

=== forehand-49k @40fps · 258 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=1806):
    buildModel           med 49.6µs p95 66.9µs
    frameFromModel       med 6.8µs p95 11.0µs
    solveEffectiveFrame  med 624.1µs p95 684.8µs
    analyzePose          med 29.6µs p95 41.9µs
    frameAt              med 56.6µs p95 83.0µs  (交叉校验 n=455)
    samplePose           med 54.5µs p95 72.5µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 191.90ms p95 199.80ms
    stringify            med 1.72ms p95 1.97ms
    probeFrames          med 157.80ms p95 158.60ms
    analyzeProbeFrames   med 3.51ms p95 3.86ms
    probeDocument        med 161.40ms p95 165.40ms
  roll-up (占 solveWorkshop median 191.90ms 的份额):
    compile          = buildModel                     med 13.15ms p95 19.91ms  6.854%
    sample           = frameFromModel                 med 1.86ms p95 2.29ms  0.9684%
    solve            = solveEffectiveFrame+analyzePose med 171.00ms p95 174.40ms  89.13%
    captureSerialize = 残差+stringify                 med 7.57ms p95 7.82ms  3.947%  (残差 5.85ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1345 samples/s · 包体 823KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 680.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 44.92ms/刷新 — 估算非实测
  内存: churn med 21.0MB p95 22.3MB /rep · post-gc heap 22→23→22→22→22→22→22MB

=== forehand-49k @60fps · 362 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=2534):
    buildModel           med 49.2µs p95 57.9µs
    frameFromModel       med 6.2µs p95 9.5µs
    solveEffectiveFrame  med 621.6µs p95 678.1µs
    analyzePose          med 29.4µs p95 40.1µs
    frameAt              med 55.5µs p95 67.0µs  (交叉校验 n=511)
    samplePose           med 53.5µs p95 57.9µs  (交叉校验 n=511)
  每rep (n=7):
    solveWorkshop        med 268.30ms p95 273.50ms
    stringify            med 2.49ms p95 2.61ms
    probeFrames          med 234.90ms p95 239.30ms
    analyzeProbeFrames   med 5.26ms p95 5.53ms
    probeDocument        med 238.80ms p95 242.20ms
  roll-up (占 solveWorkshop median 268.30ms 的份额):
    compile          = buildModel                     med 18.44ms p95 18.82ms  6.873%
    sample           = frameFromModel                 med 2.35ms p95 2.45ms  0.8745%
    solve            = solveEffectiveFrame+analyzePose med 238.50ms p95 239.80ms  88.9%
    captureSerialize = 残差+stringify                 med 11.48ms p95 11.61ms  4.281%  (残差 9.00ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1349 samples/s · 包体 1232KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 677.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 44.69ms/刷新 — 估算非实测
  内存: churn med 12.1MB p95 12.3MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== forehand-49k @240fps · 1298 samples · 49 keys · 5.2s · motionFile ===
  每样本 (n=9086):
    buildModel           med 49.4µs p95 59.1µs
    frameFromModel       med 6.0µs p95 9.6µs
    solveEffectiveFrame  med 621.2µs p95 680.7µs
    analyzePose          med 29.4µs p95 40.6µs
    frameAt              med 55.7µs p95 68.5µs  (交叉校验 n=455)
    samplePose           med 53.9µs p95 58.8µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 958.50ms p95 970.70ms
    stringify            med 9.84ms p95 11.68ms
    probeFrames          med 944.00ms p95 965.20ms
    analyzeProbeFrames   med 15.16ms p95 19.53ms
    probeDocument        med 960.10ms p95 1011.00ms
  roll-up (占 solveWorkshop median 958.50ms 的份额):
    compile          = buildModel                     med 67.04ms p95 67.35ms  6.994%
    sample           = frameFromModel                 med 8.35ms p95 8.49ms  0.8712%
    solve            = solveEffectiveFrame+analyzePose med 856.20ms p95 857.60ms  89.32%
    captureSerialize = 残差+stringify                 med 36.79ms p95 38.63ms  3.838%  (残差 26.95ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1354 samples/s · 包体 4901KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 676.9µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 44.68ms/刷新 — 估算非实测
  内存: churn med 60.3MB p95 73.1MB /rep · post-gc heap 40→40→40→40→40→40→39MB

=== k5-d2 @40fps · 86 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=602):
    buildModel           med 7.1µs p95 8.1µs
    frameFromModel       med 5.5µs p95 7.1µs
    solveEffectiveFrame  med 634.2µs p95 719.6µs
    analyzePose          med 29.7µs p95 43.0µs
    frameAt              med 14.0µs p95 26.9µs  (交叉校验 n=602)
    samplePose           med 12.4µs p95 14.7µs  (交叉校验 n=602)
  每rep (n=7):
    solveWorkshop        med 61.46ms p95 62.92ms
    stringify            med 1.81ms p95 1.97ms
    probeFrames          med 58.20ms p95 59.40ms
    analyzeProbeFrames   med 1.61ms p95 1.78ms
    probeDocument        med 60.16ms p95 61.23ms
  roll-up (占 solveWorkshop median 61.46ms 的份额):
    compile          = buildModel                     med 634.3µs p95 658.6µs  1.032%
    sample           = frameFromModel                 med 479.0µs p95 517.6µs  0.7794%
    solve            = solveEffectiveFrame+analyzePose med 58.13ms p95 58.52ms  94.59%
    captureSerialize = 残差+stringify                 med 4.02ms p95 4.18ms  6.54%  (残差 2.21ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1399 samples/s · 包体 309.8KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 648.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.78ms/刷新 — 估算非实测
  内存: churn med 9.8MB p95 16.0MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k5-d2 @60fps · 126 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=882):
    buildModel           med 7.1µs p95 8.1µs
    frameFromModel       med 4.9µs p95 6.4µs
    solveEffectiveFrame  med 631.6µs p95 708.4µs
    analyzePose          med 29.8µs p95 42.2µs
    frameAt              med 13.5µs p95 23.5µs  (交叉校验 n=882)
    samplePose           med 11.8µs p95 14.1µs  (交叉校验 n=882)
  每rep (n=7):
    solveWorkshop        med 89.71ms p95 111.40ms
    stringify            med 2.47ms p95 2.65ms
    probeFrames          med 86.38ms p95 92.36ms
    analyzeProbeFrames   med 2.40ms p95 2.45ms
    probeDocument        med 88.59ms p95 110.40ms
  roll-up (占 solveWorkshop median 89.71ms 的份额):
    compile          = buildModel                     med 939.7µs p95 1.05ms  1.047%
    sample           = frameFromModel                 med 618.2µs p95 662.0µs  0.6891%
    solve            = solveEffectiveFrame+analyzePose med 84.48ms p95 89.20ms  94.17%
    captureSerialize = 残差+stringify                 med 6.14ms p95 6.32ms  6.848%  (残差 3.68ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1404 samples/s · 包体 461.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 645.1µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.58ms/刷新 — 估算非实测
  内存: churn med 44.3MB p95 44.9MB /rep · post-gc heap 21→21→21→21→21→21→21MB

=== k5-d2 @240fps · 486 samples · 5 keys · 2s · bench seed1 ===
  每样本 (n=3402):
    buildModel           med 7.6µs p95 14.8µs
    frameFromModel       med 5.4µs p95 9.6µs
    solveEffectiveFrame  med 631.5µs p95 710.4µs
    analyzePose          med 29.0µs p95 43.4µs
    frameAt              med 13.5µs p95 26.0µs  (交叉校验 n=490)
    samplePose           med 11.8µs p95 14.4µs  (交叉校验 n=490)
  每rep (n=7):
    solveWorkshop        med 340.40ms p95 366.60ms
    stringify            med 9.34ms p95 10.38ms
    probeFrames          med 344.60ms p95 370.20ms
    analyzeProbeFrames   med 6.51ms p95 7.65ms
    probeDocument        med 351.30ms p95 365.80ms
  roll-up (占 solveWorkshop median 340.40ms 的份额):
    compile          = buildModel                     med 4.06ms p95 4.47ms  1.192%
    sample           = frameFromModel                 med 2.85ms p95 2.90ms  0.8383%
    solve            = solveEffectiveFrame+analyzePose med 327.70ms p95 329.00ms  96.26%
    captureSerialize = 残差+stringify                 med 15.17ms p95 16.22ms  4.456%  (残差 5.83ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1428 samples/s · 包体 1823KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 645.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.57ms/刷新 — 估算非实测
  内存: churn med 29.4MB p95 37.8MB /rep · post-gc heap 26→26→26→30→27→27→27MB

=== k5-d5 @40fps · 206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=1442):
    buildModel           med 7.2µs p95 14.4µs
    frameFromModel       med 5.3µs p95 9.8µs
    solveEffectiveFrame  med 634.1µs p95 734.5µs
    analyzePose          med 29.3µs p95 44.6µs
    frameAt              med 13.3µs p95 25.6µs  (交叉校验 n=483)
    samplePose           med 11.6µs p95 15.1µs  (交叉校验 n=483)
  每rep (n=7):
    solveWorkshop        med 146.00ms p95 146.80ms
    stringify            med 4.14ms p95 4.30ms
    probeFrames          med 144.00ms p95 145.70ms
    analyzeProbeFrames   med 3.38ms p95 3.49ms
    probeDocument        med 147.20ms p95 205.90ms
  roll-up (占 solveWorkshop median 146.00ms 的份额):
    compile          = buildModel                     med 1.69ms p95 1.90ms  1.156%
    sample           = frameFromModel                 med 1.17ms p95 1.23ms  0.8016%
    solve            = solveEffectiveFrame+analyzePose med 139.20ms p95 143.00ms  95.37%
    captureSerialize = 残差+stringify                 med 8.05ms p95 8.21ms  5.513%  (残差 3.91ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1411 samples/s · 包体 759.5KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 647.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.73ms/刷新 — 估算非实测
  内存: churn med 48.6MB p95 49.0MB /rep · post-gc heap 22→22→22→22→22→22→23MB

=== k5-d5 @60fps · 306 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=2142):
    buildModel           med 8.2µs p95 14.5µs
    frameFromModel       med 5.3µs p95 8.6µs
    solveEffectiveFrame  med 629.0µs p95 697.7µs
    analyzePose          med 29.1µs p95 41.6µs
    frameAt              med 14.1µs p95 23.0µs  (交叉校验 n=539)
    samplePose           med 12.3µs p95 14.5µs  (交叉校验 n=539)
  每rep (n=7):
    solveWorkshop        med 217.50ms p95 231.10ms
    stringify            med 6.40ms p95 6.97ms
    probeFrames          med 217.20ms p95 221.80ms
    analyzeProbeFrames   med 4.66ms p95 4.82ms
    probeDocument        med 223.00ms p95 224.80ms
  roll-up (占 solveWorkshop median 217.50ms 的份额):
    compile          = buildModel                     med 2.66ms p95 3.29ms  1.224%
    sample           = frameFromModel                 med 1.75ms p95 1.82ms  0.8038%
    solve            = solveEffectiveFrame+analyzePose med 203.70ms p95 206.10ms  93.67%
    captureSerialize = 残差+stringify                 med 15.77ms p95 16.34ms  7.25%  (残差 9.37ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1407 samples/s · 包体 1138KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 643.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.44ms/刷新 — 估算非实测
  内存: churn med 8.2MB p95 68.3MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k5-d5 @240fps · 1206 samples · 5 keys · 5s · bench seed1 ===
  每样本 (n=8442):
    buildModel           med 7.6µs p95 14.2µs
    frameFromModel       med 5.5µs p95 8.9µs
    solveEffectiveFrame  med 629.7µs p95 700.9µs
    analyzePose          med 29.2µs p95 42.3µs
    frameAt              med 13.5µs p95 23.9µs  (交叉校验 n=469)
    samplePose           med 11.9µs p95 14.0µs  (交叉校验 n=469)
  每rep (n=7):
    solveWorkshop        med 844.40ms p95 858.50ms
    stringify            med 23.21ms p95 24.18ms
    probeFrames          med 855.20ms p95 912.40ms
    analyzeProbeFrames   med 14.85ms p95 18.54ms
    probeDocument        med 868.50ms p95 879.60ms
  roll-up (占 solveWorkshop median 844.40ms 的份额):
    compile          = buildModel                     med 10.20ms p95 10.28ms  1.208%
    sample           = frameFromModel                 med 6.99ms p95 7.29ms  0.8278%
    solve            = solveEffectiveFrame+analyzePose med 806.70ms p95 817.10ms  95.53%
    captureSerialize = 残差+stringify                 med 43.73ms p95 44.70ms  5.179%  (残差 20.53ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1428 samples/s · 包体 4526KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 643.2µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.45ms/刷新 — 估算非实测
  内存: churn med 55.9MB p95 67.9MB /rep · post-gc heap 38→38→38→38→46→38→38MB

=== k20-d2 @40fps · 101 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=707):
    buildModel           med 21.1µs p95 22.4µs
    frameFromModel       med 5.8µs p95 10.0µs
    solveEffectiveFrame  med 629.2µs p95 706.9µs
    analyzePose          med 29.6µs p95 41.8µs
    frameAt              med 29.8µs p95 45.3µs  (交叉校验 n=707)
    samplePose           med 27.1µs p95 34.2µs  (交叉校验 n=707)
  每rep (n=7):
    solveWorkshop        med 75.45ms p95 76.34ms
    stringify            med 2.09ms p95 2.56ms
    probeFrames          med 60.31ms p95 67.19ms
    analyzeProbeFrames   med 1.64ms p95 1.85ms
    probeDocument        med 61.02ms p95 63.61ms
  roll-up (占 solveWorkshop median 75.45ms 的份额):
    compile          = buildModel                     med 2.16ms p95 2.35ms  2.868%
    sample           = frameFromModel                 med 613.8µs p95 924.7µs  0.8135%
    solve            = solveEffectiveFrame+analyzePose med 67.90ms p95 68.12ms  89.99%
    captureSerialize = 残差+stringify                 med 6.86ms p95 7.33ms  9.092%  (残差 4.77ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1339 samples/s · 包体 311.9KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 659.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.49ms/刷新 — 估算非实测
  内存: churn med 41.4MB p95 43.5MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k20-d2 @60fps · 141 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=987):
    buildModel           med 22.2µs p95 34.6µs
    frameFromModel       med 5.9µs p95 10.2µs
    solveEffectiveFrame  med 630.7µs p95 762.8µs
    analyzePose          med 29.7µs p95 47.8µs
    frameAt              med 29.2µs p95 49.3µs  (交叉校验 n=497)
    samplePose           med 26.8µs p95 33.0µs  (交叉校验 n=497)
  每rep (n=7):
    solveWorkshop        med 103.50ms p95 105.50ms
    stringify            med 2.64ms p95 2.99ms
    probeFrames          med 89.23ms p95 90.24ms
    analyzeProbeFrames   med 2.41ms p95 2.61ms
    probeDocument        med 91.83ms p95 92.94ms
  roll-up (占 solveWorkshop median 103.50ms 的份额):
    compile          = buildModel                     med 3.25ms p95 4.02ms  3.134%
    sample           = frameFromModel                 med 871.8µs p95 1.86ms  0.842%
    solve            = solveEffectiveFrame+analyzePose med 94.67ms p95 113.10ms  91.44%
    captureSerialize = 残差+stringify                 med 7.38ms p95 7.74ms  7.132%  (残差 4.75ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1362 samples/s · 包体 464KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 660.0µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.56ms/刷新 — 估算非实测
  内存: churn med 25.1MB p95 26.3MB /rep · post-gc heap 22→21→21→21→21→21→21MB

=== k20-d2 @240fps · 501 samples · 20 keys · 2s · bench seed1 ===
  每样本 (n=3507):
    buildModel           med 23.0µs p95 32.8µs
    frameFromModel       med 5.9µs p95 9.9µs
    solveEffectiveFrame  med 631.9µs p95 722.4µs
    analyzePose          med 29.6µs p95 43.2µs
    frameAt              med 29.7µs p95 44.7µs  (交叉校验 n=504)
    samplePose           med 27.0µs p95 31.2µs  (交叉校验 n=504)
  每rep (n=7):
    solveWorkshop        med 358.60ms p95 365.20ms
    stringify            med 9.46ms p95 10.44ms
    probeFrames          med 349.50ms p95 444.60ms
    analyzeProbeFrames   med 7.77ms p95 8.03ms
    probeDocument        med 357.10ms p95 456.80ms
  roll-up (占 solveWorkshop median 358.60ms 的份额):
    compile          = buildModel                     med 12.38ms p95 12.71ms  3.453%
    sample           = frameFromModel                 med 3.25ms p95 3.37ms  0.9061%
    solve            = solveEffectiveFrame+analyzePose med 338.30ms p95 341.70ms  94.35%
    captureSerialize = 残差+stringify                 med 14.10ms p95 15.08ms  3.932%  (残差 4.64ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1397 samples/s · 包体 1828KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 661.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.67ms/刷新 — 估算非实测
  内存: churn med 61.3MB p95 61.5MB /rep · post-gc heap 27→27→27→27→27→27→27MB

=== k20-d5 @40fps · 221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=1547):
    buildModel           med 22.5µs p95 30.6µs
    frameFromModel       med 5.8µs p95 9.5µs
    solveEffectiveFrame  med 627.2µs p95 703.7µs
    analyzePose          med 29.6µs p95 41.7µs
    frameAt              med 29.3µs p95 42.2µs  (交叉校验 n=518)
    samplePose           med 26.7µs p95 30.8µs  (交叉校验 n=518)
  每rep (n=7):
    solveWorkshop        med 160.00ms p95 178.40ms
    stringify            med 1.75ms p95 4.04ms
    probeFrames          med 146.70ms p95 150.40ms
    analyzeProbeFrames   med 3.65ms p95 3.85ms
    probeDocument        med 149.30ms p95 155.10ms
  roll-up (占 solveWorkshop median 160.00ms 的份额):
    compile          = buildModel                     med 5.26ms p95 5.60ms  3.289%
    sample           = frameFromModel                 med 1.37ms p95 1.52ms  0.8586%
    solve            = solveEffectiveFrame+analyzePose med 148.70ms p95 153.70ms  92.92%
    captureSerialize = 残差+stringify                 med 6.45ms p95 8.74ms  4.027%  (残差 4.70ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1381 samples/s · 包体 765.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 656.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.34ms/刷新 — 估算非实测
  内存: churn med 55.9MB p95 57.3MB /rep · post-gc heap 22→22→24→22→22→22→22MB

=== k20-d5 @60fps · 321 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=2247):
    buildModel           med 22.8µs p95 31.1µs
    frameFromModel       med 5.8µs p95 9.5µs
    solveEffectiveFrame  med 626.1µs p95 693.3µs
    analyzePose          med 29.3µs p95 41.5µs
    frameAt              med 29.2µs p95 42.3µs  (交叉校验 n=455)
    samplePose           med 26.7µs p95 30.0µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 230.40ms p95 255.30ms
    stringify            med 6.45ms p95 6.78ms
    probeFrames          med 218.80ms p95 227.40ms
    analyzeProbeFrames   med 5.22ms p95 5.30ms
    probeDocument        med 221.70ms p95 229.60ms
  roll-up (占 solveWorkshop median 230.40ms 的份额):
    compile          = buildModel                     med 7.69ms p95 8.23ms  3.339%
    sample           = frameFromModel                 med 2.02ms p95 2.15ms  0.8763%
    solve            = solveEffectiveFrame+analyzePose med 212.60ms p95 224.00ms  92.28%
    captureSerialize = 残差+stringify                 med 14.53ms p95 14.86ms  6.307%  (残差 8.08ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1393 samples/s · 包体 1146KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 655.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 43.25ms/刷新 — 估算非实测
  内存: churn med 44.5MB p95 44.6MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5 @240fps · 1221 samples · 20 keys · 5s · bench seed1 ===
  每样本 (n=8547):
    buildModel           med 22.7µs p95 28.8µs
    frameFromModel       med 5.6µs p95 8.3µs
    solveEffectiveFrame  med 621.7µs p95 667.5µs
    analyzePose          med 28.7µs p95 36.4µs
    frameAt              med 28.7µs p95 38.6µs  (交叉校验 n=455)
    samplePose           med 26.6µs p95 29.0µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 850.70ms p95 897.70ms
    stringify            med 8.29ms p95 8.51ms
    probeFrames          med 854.90ms p95 893.20ms
    analyzeProbeFrames   med 14.59ms p95 19.76ms
    probeDocument        med 865.50ms p95 918.50ms
  roll-up (占 solveWorkshop median 850.70ms 的份额):
    compile          = buildModel                     med 28.97ms p95 30.18ms  3.405%
    sample           = frameFromModel                 med 7.42ms p95 7.73ms  0.8726%
    solve            = solveEffectiveFrame+analyzePose med 806.80ms p95 819.80ms  94.84%
    captureSerialize = 残差+stringify                 med 15.81ms p95 16.04ms  1.859%  (残差 7.53ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1435 samples/s · 包体 4556KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 650.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.93ms/刷新 — 估算非实测
  内存: churn med 46.2MB p95 64.8MB /rep · post-gc heap 38→38→38→38→38→38→38MB

=== k20-d5-nib @40fps · 221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=1547):
    buildModel           med 22.3µs p95 25.4µs
    frameFromModel       med 0.8µs p95 1.3µs
    solveEffectiveFrame  med 621.8µs p95 653.8µs
    analyzePose          med 28.6µs p95 32.4µs
    frameAt              med 23.5µs p95 27.0µs  (交叉校验 n=518)
    samplePose           med 27.9µs p95 31.8µs  (交叉校验 n=518)
  每rep (n=7):
    solveWorkshop        med 155.30ms p95 195.60ms
    stringify            med 1.58ms p95 1.92ms
    probeFrames          med 143.80ms p95 152.00ms
    analyzeProbeFrames   med 3.49ms p95 3.64ms
    probeDocument        med 144.90ms p95 149.70ms
  roll-up (占 solveWorkshop median 155.30ms 的份额):
    compile          = buildModel                     med 5.02ms p95 5.33ms  3.23%
    sample           = frameFromModel                 med 190.7µs p95 273.2µs  0.1228%
    solve            = solveEffectiveFrame+analyzePose med 144.50ms p95 146.10ms  93.06%
    captureSerialize = 残差+stringify                 med 7.15ms p95 7.49ms  4.604%  (残差 5.57ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1423 samples/s · 包体 763.1KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 645.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.60ms/刷新 — 估算非实测
  内存: churn med 50.6MB p95 53.9MB /rep · post-gc heap 22→22→22→22→22→22→22MB

=== k20-d5-nib @60fps · 321 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=2247):
    buildModel           med 22.9µs p95 34.1µs
    frameFromModel       med 0.9µs p95 1.6µs
    solveEffectiveFrame  med 624.6µs p95 725.2µs
    analyzePose          med 29.1µs p95 43.4µs
    frameAt              med 24.3µs p95 41.7µs  (交叉校验 n=455)
    samplePose           med 29.4µs p95 37.3µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 225.80ms p95 230.10ms
    stringify            med 6.00ms p95 6.27ms
    probeFrames          med 215.90ms p95 229.00ms
    analyzeProbeFrames   med 4.85ms p95 5.06ms
    probeDocument        med 218.30ms p95 225.10ms
  roll-up (占 solveWorkshop median 225.80ms 的份额):
    compile          = buildModel                     med 8.01ms p95 8.99ms  3.546%
    sample           = frameFromModel                 med 325.6µs p95 379.0µs  0.1442%
    solve            = solveEffectiveFrame+analyzePose med 217.90ms p95 271.20ms  96.52%
    captureSerialize = 残差+stringify                 med 5.52ms p95 5.79ms  2.447%  (残差 -480.6µs)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1422 samples/s · 包体 1143KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 648.9µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.83ms/刷新 — 估算非实测
  内存: churn med 36.0MB p95 36.0MB /rep · post-gc heap 24→24→24→24→24→24→24MB

=== k20-d5-nib @240fps · 1221 samples · 20 keys · 5s · bench seed1 · 无补间 ===
  每样本 (n=8547):
    buildModel           med 23.0µs p95 31.5µs
    frameFromModel       med 0.8µs p95 1.4µs
    solveEffectiveFrame  med 623.2µs p95 685.5µs
    analyzePose          med 28.7µs p95 40.7µs
    frameAt              med 24.1µs p95 32.0µs  (交叉校验 n=455)
    samplePose           med 31.8µs p95 38.7µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 861.80ms p95 879.00ms
    stringify            med 7.28ms p95 7.88ms
    probeFrames          med 863.00ms p95 910.50ms
    analyzeProbeFrames   med 13.88ms p95 16.74ms
    probeDocument        med 873.50ms p95 881.50ms
  roll-up (占 solveWorkshop median 861.80ms 的份额):
    compile          = buildModel                     med 29.58ms p95 30.31ms  3.432%
    sample           = frameFromModel                 med 1.12ms p95 1.18ms  0.1304%
    solve            = solveEffectiveFrame+analyzePose med 807.80ms p95 815.90ms  93.73%
    captureSerialize = 残差+stringify                 med 30.62ms p95 31.22ms  3.553%  (残差 23.34ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1417 samples/s · 包体 4543KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 647.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 42.72ms/刷新 — 估算非实测
  内存: churn med 83.2MB p95 84.0MB /rep · post-gc heap 37→37→37→37→37→37→37MB

=== k100-d2 @40fps · 181 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1267):
    buildModel           med 98.1µs p95 107.6µs
    frameFromModel       med 6.3µs p95 8.1µs
    solveEffectiveFrame  med 627.9µs p95 671.8µs
    analyzePose          med 29.6µs p95 39.4µs
    frameAt              med 105.5µs p95 117.2µs  (交叉校验 n=637)
    samplePose           med 102.1µs p95 111.9µs  (交叉校验 n=637)
  每rep (n=7):
    solveWorkshop        med 145.50ms p95 147.10ms
    stringify            med 1.95ms p95 2.05ms
    probeFrames          med 64.29ms p95 65.71ms
    analyzeProbeFrames   med 1.92ms p95 2.12ms
    probeDocument        med 66.72ms p95 72.05ms
  roll-up (占 solveWorkshop median 145.50ms 的份额):
    compile          = buildModel                     med 18.44ms p95 18.83ms  12.68%
    sample           = frameFromModel                 med 1.17ms p95 1.23ms  0.8042%
    solve            = solveEffectiveFrame+analyzePose med 120.20ms p95 123.60ms  82.62%
    captureSerialize = 残差+stringify                 med 7.62ms p95 7.72ms  5.239%  (残差 5.67ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1244 samples/s · 包体 315.4KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 733.4µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.40ms/刷新 — 估算非实测
  内存: churn med 16.8MB p95 17.8MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k100-d2 @60fps · 221 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=1547):
    buildModel           med 97.9µs p95 105.4µs
    frameFromModel       med 6.2µs p95 7.7µs
    solveEffectiveFrame  med 630.9µs p95 662.5µs
    analyzePose          med 29.4µs p95 33.4µs
    frameAt              med 104.7µs p95 111.9µs  (交叉校验 n=518)
    samplePose           med 101.7µs p95 107.6µs  (交叉校验 n=518)
  每rep (n=7):
    solveWorkshop        med 176.30ms p95 181.90ms
    stringify            med 2.63ms p95 2.68ms
    probeFrames          med 97.73ms p95 114.80ms
    analyzeProbeFrames   med 2.60ms p95 2.74ms
    probeDocument        med 98.96ms p95 107.80ms
  roll-up (占 solveWorkshop median 176.30ms 的份额):
    compile          = buildModel                     med 22.31ms p95 22.62ms  12.66%
    sample           = frameFromModel                 med 1.43ms p95 1.47ms  0.813%
    solve            = solveEffectiveFrame+analyzePose med 146.70ms p95 148.70ms  83.23%
    captureSerialize = 残差+stringify                 med 8.45ms p95 8.51ms  4.796%  (残差 5.83ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1254 samples/s · 包体 467.3KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 735.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.55ms/刷新 — 估算非实测
  内存: churn med 5.2MB p95 6.6MB /rep · post-gc heap 20→20→20→20→20→20→20MB

=== k100-d2 @240fps · 581 samples · 100 keys · 2s · bench seed1 ===
  每样本 (n=4067):
    buildModel           med 98.5µs p95 106.5µs
    frameFromModel       med 6.2µs p95 8.1µs
    solveEffectiveFrame  med 626.7µs p95 661.7µs
    analyzePose          med 29.3µs p95 33.7µs
    frameAt              med 104.9µs p95 114.5µs  (交叉校验 n=455)
    samplePose           med 101.8µs p95 108.0µs  (交叉校验 n=455)
  每rep (n=7):
    solveWorkshop        med 455.10ms p95 519.00ms
    stringify            med 3.85ms p95 4.19ms
    probeFrames          med 381.90ms p95 482.10ms
    analyzeProbeFrames   med 7.92ms p95 8.23ms
    probeDocument        med 389.20ms p95 445.00ms
  roll-up (占 solveWorkshop median 455.10ms 的份额):
    compile          = buildModel                     med 58.82ms p95 60.61ms  12.92%
    sample           = frameFromModel                 med 3.72ms p95 3.97ms  0.817%
    solve            = solveEffectiveFrame+analyzePose med 383.40ms p95 392.30ms  84.24%
    captureSerialize = 残差+stringify                 med 13.02ms p95 13.36ms  2.861%  (残差 9.17ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1277 samples/s · 包体 1827KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 731.6µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.29ms/刷新 — 估算非实测
  内存: churn med 30.3MB p95 30.6MB /rep · post-gc heap 26→26→26→26→26→26→26MB

=== k100-d5 @40fps · 301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2107):
    buildModel           med 98.4µs p95 105.3µs
    frameFromModel       med 6.2µs p95 7.6µs
    solveEffectiveFrame  med 625.8µs p95 657.1µs
    analyzePose          med 29.2µs p95 33.2µs
    frameAt              med 104.9µs p95 114.5µs  (交叉校验 n=532)
    samplePose           med 101.9µs p95 107.7µs  (交叉校验 n=532)
  每rep (n=7):
    solveWorkshop        med 239.30ms p95 303.90ms
    stringify            med 1.79ms p95 2.05ms
    probeFrames          med 159.30ms p95 166.10ms
    analyzeProbeFrames   med 3.82ms p95 4.02ms
    probeDocument        med 163.80ms p95 165.30ms
  roll-up (占 solveWorkshop median 239.30ms 的份额):
    compile          = buildModel                     med 30.50ms p95 30.69ms  12.74%
    sample           = frameFromModel                 med 1.93ms p95 1.98ms  0.8052%
    solve            = solveEffectiveFrame+analyzePose med 198.30ms p95 201.30ms  82.86%
    captureSerialize = 残差+stringify                 med 10.39ms p95 10.66ms  4.342%  (残差 8.60ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1258 samples/s · 包体 767.7KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 730.7µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.23ms/刷新 — 估算非实测
  内存: churn med 48.1MB p95 48.1MB /rep · post-gc heap 22→22→23→22→22→22→22MB

=== k100-d5 @60fps · 401 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=2807):
    buildModel           med 99.5µs p95 121.5µs
    frameFromModel       med 6.4µs p95 9.8µs
    solveEffectiveFrame  med 630.5µs p95 736.5µs
    analyzePose          med 29.7µs p95 42.6µs
    frameAt              med 106.3µs p95 136.2µs  (交叉校验 n=469)
    samplePose           med 102.5µs p95 122.5µs  (交叉校验 n=469)
  每rep (n=7):
    solveWorkshop        med 316.60ms p95 332.40ms
    stringify            med 2.56ms p95 2.72ms
    probeFrames          med 240.10ms p95 248.10ms
    analyzeProbeFrames   med 5.30ms p95 5.39ms
    probeDocument        med 244.20ms p95 255.30ms
  roll-up (占 solveWorkshop median 316.60ms 的份额):
    compile          = buildModel                     med 41.49ms p95 45.76ms  13.1%
    sample           = frameFromModel                 med 2.71ms p95 3.20ms  0.8572%
    solve            = solveEffectiveFrame+analyzePose med 271.60ms p95 329.00ms  85.78%
    captureSerialize = 残差+stringify                 med 3.36ms p95 3.52ms  1.06%  (残差 802.7µs)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1267 samples/s · 包体 1147KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 736.8µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.63ms/刷新 — 估算非实测
  内存: churn med 17.8MB p95 19.1MB /rep · post-gc heap 23→23→23→23→23→23→23MB

=== k100-d5 @240fps · 1301 samples · 100 keys · 5s · bench seed1 ===
  每样本 (n=9107):
    buildModel           med 99.2µs p95 118.9µs
    frameFromModel       med 6.1µs p95 9.3µs
    solveEffectiveFrame  med 624.3µs p95 701.4µs
    analyzePose          med 29.2µs p95 40.5µs
    frameAt              med 105.9µs p95 127.4µs  (交叉校验 n=462)
    samplePose           med 102.2µs p95 117.2µs  (交叉校验 n=462)
  每rep (n=7):
    solveWorkshop        med 1046.00ms p95 1103.00ms
    stringify            med 8.56ms p95 8.83ms
    probeFrames          med 990.50ms p95 1006.00ms
    analyzeProbeFrames   med 19.26ms p95 20.84ms
    probeDocument        med 984.50ms p95 1039.00ms
  roll-up (占 solveWorkshop median 1046.00ms 的份额):
    compile          = buildModel                     med 135.10ms p95 150.10ms  12.91%
    sample           = frameFromModel                 med 8.45ms p95 10.47ms  0.8073%
    solve            = solveEffectiveFrame+analyzePose med 867.00ms p95 931.90ms  82.88%
    captureSerialize = 残差+stringify                 med 44.09ms p95 44.35ms  4.214%  (残差 35.53ms)
    render           = 未测量（浏览器侧另计；captureSerialize 残差见上）
  吞吐: 1244 samples/s · 包体 4547KB
  derived.workshop 拖拽/洋葱皮估算: frameAt+solve 730.3µs/帧 × (1 播放头 + 61 轨迹 + 4 洋葱皮) ≈ 48.20ms/刷新 — 估算非实测
  内存: churn med 68.7MB p95 75.5MB /rep · post-gc heap 37→37→37→37→37→37→37MB

=== hotspots（全场景份额排序）===
  1. solve              90.62%
  2. compile            6.082%
  3. captureSerialize   4.093%
  4. sample             0.74%
  render             未测量（浏览器侧另计）
