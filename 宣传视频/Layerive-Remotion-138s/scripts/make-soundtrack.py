"""Deterministic, original electronic soundtrack. No sampled recordings."""
from pathlib import Path
import wave
import numpy as np

SR = 48000
DURATION = 138
rng = np.random.default_rng(93026)
mix = np.zeros((SR * DURATION, 2), dtype=np.float64)

def add(sound, start, gain=1, pan=0):
    a = int(start * SR)
    if a >= len(mix): return
    sound = sound[:len(mix)-a] * gain
    mix[a:a+len(sound), 0] += sound * np.sqrt((1-pan)/2)
    mix[a:a+len(sound), 1] += sound * np.sqrt((1+pan)/2)

def tone(freq, dur, style='pluck'):
    t = np.arange(int(SR*dur))/SR
    if style == 'pad':
        sig = sum(np.sin(2*np.pi*(freq*(1+k*.0016))*t+p) for k,p in [(-1,.3),(0,0),(1,.8)])/3
        env = np.minimum(t/.65,1) * np.minimum((dur-t)/.8,1)
        return sig*env*.5
    if style == 'bass':
        return (np.sin(2*np.pi*freq*t)+.22*np.sin(4*np.pi*freq*t))*np.exp(-t*5)*np.minimum(t/.012,1)
    sig = np.sin(2*np.pi*freq*t)+.28*np.sin(4*np.pi*freq*t)+.1*np.sin(6*np.pi*freq*t)
    return sig*np.exp(-t*7)*np.minimum(t/.006,1)

def freq(note): return 440 * 2**((note-69)/12)

# Dm9 – Bbmaj7 – Fmaj9 – Csus2, two bars per chord, 120 BPM.
chords = [[50,57,60,64,69],[46,53,57,60,65],[48,53,57,60,67],[48,55,62,64,67]]
for bar in range(35):
    start = bar*4
    chord = chords[bar%4]
    for j,n in enumerate(chord): add(tone(freq(n),4.8,'pad'),start,.11,(-.7+j*.35))
    if 18 <= start < 130:
        for b in range(8): add(tone(freq(chord[0]-12),.48,'bass'),start+b*.5,.21)
    for step in range(16):
        at = start+step*.25
        n = chord[[0,2,3,1,4,2,3,1][step%8]]+12
        weight = .043 if at<18 or at>130 else .078
        note = tone(freq(n),.65)
        add(note,at,weight,np.sin(step*.9)*.65)
        add(note,at+.375,weight*.28,-np.sin(step*.9)*.65)

for beat in range(36,260):
    at=beat*.5
    t=np.arange(int(.42*SR))/SR
    phase=2*np.pi*(46*t+90*.025*(1-np.exp(-t/.025)))
    kick=np.sin(phase)*np.exp(-t*11)+rng.normal(0,.14,len(t))*np.exp(-t*180)
    add(kick,at,.33)
    t=np.arange(int(.095*SR))/SR
    noise=rng.normal(0,1,len(t)); high=np.concatenate([[0],np.diff(noise)])
    add(high*np.exp(-t*62),at+.25,.019,(-.5 if beat%2 else .5))
    if beat%2:
        t=np.arange(int(.19*SR))/SR
        snare=(rng.normal(0,1,len(t))*.7+np.sin(2*np.pi*180*t)*.3)*np.exp(-t*28)
        add(snare,at,.078,.05)

for cut in [18,28,40,52,66,78,92,110,118,130]:
    t=np.arange(int(.65*SR))/SR
    sweep=np.sin(2*np.pi*(420*t+1100*t*t))*.13+rng.normal(0,.11,len(t))
    env=np.sin(np.pi*t/.65)**3
    add(sweep*env,cut-.47,.15,-.25)
    add(tone(freq(86),1),cut,.075,.35)

for n in [50,57,62,65,69]: add(tone(freq(n),7.7,'pad'),130,.12)
t=np.arange(len(mix))/SR
fade=np.minimum(t/1.5,1)*np.minimum((DURATION-t)/3.0,1)
mix=np.tanh(mix*1.2)*fade[:,None]
mix=mix/max(np.max(np.abs(mix)),1e-8)*.84
out=Path(__file__).resolve().parents[1]/'public'/'soundtrack.wav'
with wave.open(str(out),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
    f.writeframes((mix*32767).astype('<i2').tobytes())
print(f'{out}: {DURATION}s original stereo score; peak {np.max(np.abs(mix)):.3f}')
