# 产品素材

两张 WebP 均由用户提供的 reComputer Industrial 组合产品图裁切得到，保留真实设备外观和透明背景。

- `product-horizontal.webp` 用于顶部产品栏，500×229，约16KB。
- `product-vertical.webp` 用于侧栏，300×438，约14KB。

更新这两张图片后，在项目根目录运行 `node scripts/embed_product_images.mjs`，将素材写入首页。设备现有静态文件白名单无需增加路径。

原图为3207×1912。水平图裁切区域为 x=1300、y=1030、宽1900、高870，再缩放至500px宽；竖图裁切区域为 x=0、y=0、宽1280、高1870，再缩放至300px宽。压缩质量分别为86、84。
