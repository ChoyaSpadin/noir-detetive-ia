import { useEffect, useState, type MouseEvent, type PointerEvent } from 'react'
import { getVolume, getVolumeSetting, onSoundChange, setMuted, setVolume, startAmbience } from '../audio/ambience'

interface SoundControlProps {
  /** 'floating': fixo no canto da tela. 'inline': dentro de outra barra (HUD, intro). */
  variant?: 'floating' | 'inline'
}

// Mudo + volume (voz e chuva). O estado é global, então todas as cópias ficam em sincronia.
export function SoundControl({ variant = 'inline' }: SoundControlProps) {
  const [volume, setVol] = useState(getVolumeSetting)
  const [audible, setAudible] = useState(() => getVolume() > 0)

  useEffect(
    () =>
      onSoundChange(() => {
        setVol(getVolumeSetting())
        setAudible(getVolume() > 0)
      }),
    [],
  )

  const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation() // não avançar a intro

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (audible) {
      setMuted(true)
    } else {
      if (getVolumeSetting() === 0) setVolume(0.6)
      setMuted(false)
      startAmbience()
    }
  }

  const icon = !audible ? '🔇' : volume < 0.4 ? '🔈' : volume < 0.75 ? '🔉' : '🔊'
  const shown = audible ? volume : 0

  return (
    <div className={`sound-control sound-control-${variant}`} onClick={stop} onPointerDown={stop}>
      <button
        type="button"
        className="sound-control-btn"
        onClick={toggle}
        aria-label={audible ? 'Silenciar som' : 'Ativar som'}
        title={audible ? 'Silenciar som' : 'Ativar som'}
      >
        {icon}
      </button>
      <input
        type="range"
        className="sound-control-slider"
        min={0}
        max={100}
        step={5}
        value={Math.round(shown * 100)}
        onChange={(e) => {
          const v = Number(e.target.value) / 100
          setVolume(v)
          if (v === 0) setMuted(true)
          else startAmbience()
        }}
        aria-label="Volume"
        style={{ ['--fill' as string]: `${Math.round(shown * 100)}%` }}
      />
    </div>
  )
}
