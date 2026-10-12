import sys
from PIL import Image
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as sw
s=Image.open(sys.argv[1]).convert('RGB'); p=Image.open(sys.argv[2]).convert('RGB').resize(s.size)
a=np.asarray(s).astype(int); b=np.asarray(p).astype(int)
def masks(x):
    r,g,bb=x[...,0],x[...,1],x[...,2]
    return {'blue ink':(bb-r>40)&(r<120),'red sig':(r-bb>80)&(g<120),'green rect':(g-r>40)&(g-bb>40),'yellow hl':(r>200)&(g>190)&(bb<190)}
def dil(m,k=1): return sw(np.pad(m,k),(2*k+1,2*k+1)).any(axis=(-1,-2))
ma,mb=masks(a),masks(b)
for k in ma:
    A,B=ma[k],mb[k]
    if A.sum()==0 and B.sum()==0: continue
    print(f"  {k:10s} screen {A.sum():6d} pdf {B.sum():6d}  pdf∈screen±1px {(B&dil(A)).sum()/max(1,B.sum()):.3f}  screen∈pdf±1px {(A&dil(B)).sum()/max(1,A.sum()):.3f}")
if len(sys.argv)>3: Image.blend(s,p,0.5).save(sys.argv[3])
