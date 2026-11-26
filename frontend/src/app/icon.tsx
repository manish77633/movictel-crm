import { ImageResponse } from 'next/og'
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        height: 32,
        width: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        background: '#2855d9',
        borderRadius: 7,
      }}
    >
      {[8, 15, 21, 12].map((height, index) => (
        <div key={index} style={{ width: 2, height, background: 'white', borderRadius: 2 }} />
      ))}
    </div>,
    size,
  )
}
