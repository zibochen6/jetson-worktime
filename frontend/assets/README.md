# 产品素材

两张 WebP 均由用户提供的 reComputer Industrial 组合产品图裁切得到，保留真实设备外观和透明背景。

- `product-horizontal.webp` 用于顶部产品栏，500×229，约16KB。
- `product-vertical.webp` 用于侧栏，300×415，包含完整立式机身、侧边安装片和透明留白，已移除横置设备的绿色残片。

更新这两张图片后，在项目根目录运行 `node scripts/embed_product_images.mjs`，将素材写入首页。设备现有静态文件白名单无需增加路径。

原图为3207×1912。水平图裁切区域为 x=1300、y=1030、宽1900、高870，再缩放至500px宽；竖图裁切区域为 x=0、y=0、宽1280、高1870，再缩放至300px宽。压缩质量分别为86、84。

2026-11-13：竖图基于官方 https://files.seeedstudio.com/wiki/reComputer-Industrial/2.png 重新提取整理，使用图像编辑工具完成透明抠图，再压缩为 WebP。旧的矩形裁切流程不再用于竖图。
