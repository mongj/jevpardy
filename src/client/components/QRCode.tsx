import { useMemo } from "react";
import { encode } from "uqr";

export function QRCode({ value, size = 168 }: { value: string; size?: number }) {
  const qr = useMemo(() => encode(value, { ecc: "M", border: 2 }), [value]);
  const cells: { x: number; y: number }[] = [];
  qr.data.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) cells.push({ x, y });
    }),
  );
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${value}`}>
      <rect width={qr.size} height={qr.size} fill="#f4f1ff" />
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} fill="#05040f" />
      ))}
    </svg>
  );
}
