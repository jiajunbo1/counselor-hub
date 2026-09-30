// 全站唯一的印章规格：尺寸/浓度/角度只在这里定义，改一处所有卡片同步。
// 印章是绝对定位的水印层（不参与布局、不决定卡片高度），正文只需让出由同一尺寸推导出的固定安全宽度。
export const STAMP_SIZE = 68;
// 旋转 -14° 会让外接方框每侧再外扩约 7px，安全宽度按「直径 + 外扩 + 呼吸间距」取值
const STAMP_INSET = "12px";
const STAMP_OPACITY = 0.75;

// 正文右侧安全宽度：随 STAMP_SIZE 自动变化，卡片不必各自手调
export const stampSafeWidth = `${STAMP_SIZE + 16}px`;

export function StatusStamp({ color, label }: { color: string; label: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-0 select-none"
      style={{
        right: STAMP_INSET,
        top: STAMP_INSET,
        width: STAMP_SIZE,
        height: STAMP_SIZE,
        transform: "rotate(-14deg)",
        opacity: STAMP_OPACITY,
        color,
      }}
    >
      <div className="flex size-full items-center justify-center rounded-full border-[2.5px] p-[3px]">
        <div className="flex size-full items-center justify-center rounded-full border border-dashed px-1 text-center">
          <span className="font-black leading-tight tracking-wider" style={{ fontSize: Math.round(STAMP_SIZE * 0.17) }}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
