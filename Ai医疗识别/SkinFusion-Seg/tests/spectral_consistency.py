"""Regression: real inverse features agree across CPU/CUDA and batch sizes."""
import torch
from model.network import spectrum_to_spatial


def main():
    torch.manual_seed(42)
    torch.set_num_threads(2)
    for h, channels in [(128,8),(64,16),(32,32)]:
        real=torch.randn(1,channels,h,h//2)
        imag=torch.randn_like(real)
        padded=torch.zeros(1,channels,h,h//2+1,dtype=torch.complex64)
        padded[...,:h//2]=torch.complex(real,imag)
        reference=torch.fft.irfft2(padded,s=(h,h),norm='ortho')
        for device in ['cpu']+(['cuda:0'] if torch.cuda.is_available() else []):
            for batch in [1,2,8]:
                value=spectrum_to_spatial(real.repeat(batch,1,1,1).to(device),imag.repeat(batch,1,1,1).to(device),(h,h)).cpu()
                torch.testing.assert_close(value,reference.repeat(batch,1,1,1),rtol=2e-5,atol=2e-5)
    print('PASS: 3 feature scales, batch 1/2/8, CPU and available CUDA, CPU mathematical reference')

if __name__=='__main__': main()
