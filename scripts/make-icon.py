import struct,zlib,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1]/'build'
icons=root/'icon.iconset';icons.mkdir(exist_ok=True)
def png(n):
 rows=[]
 for y in range(n):
  row=bytearray([0])
  for x in range(n):
   xx=x/n;yy=y/n;dx=max(.15-xx,0,xx-.85);dy=max(.15-yy,0,yy-.85)
   outside=(xx<.15 or xx>.85) and (yy<.15 or yy>.85) and dx*dx+dy*dy>.15**2
   c=(39+int(yy*6),91+int(yy*7),72+int(yy*7),0 if outside else 255)
   heights=[.16,.3,.48,.35,.58,.39,.22]
   for i,h in enumerate(heights):
    cx=.27+i*.075;top=.5-h/2;bottom=.5+h/2;r=.02
    if abs(xx-cx)<=r and top<=yy<=bottom or (xx-cx)**2+(yy-top)**2<=r*r or (xx-cx)**2+(yy-bottom)**2<=r*r:c=(236,236,207,255)
   row.extend(c)
  rows.append(bytes(row))
 def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',n,n,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
for n in [16,32,128,256,512]:
 for scale in [1,2]:(icons/f'icon_{n}x{n}{"@2x" if scale==2 else ""}.png').write_bytes(png(n*scale))
subprocess.run(['iconutil','-c','icns',str(icons),'-o',str(root/'icon.icns')],check=True)
