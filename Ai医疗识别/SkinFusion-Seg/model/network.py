"""SkinFusion-Seg segmentation network."""
import torch
from torch import nn
from torch.nn import Module
from torch.nn import functional as F
from .complex_ops import ComplexConvBlock, ComplexLowpass, ComplexCBAM, LowPassFilter, ZeroPadding, ComplexConvTranspose2d, ComplexConv2d
from .context import ContextAggregation
from .resample import FeatureResampler

class EncoderDecoder(Module):

    def __init__(self, in_channels=3, out_channels=1, r=64, model_factor=4, image_size=256):
        super(EncoderDecoder, self).__init__()
        if model_factor <= 0 or any((channels % model_factor for channels in (64, 128, 256, 512, 1024))):
            raise ValueError('model_factor must be a positive common divisor of 64, 128, 256, 512, and 1024')
        if r <= 0 or 2 * r > image_size:
            raise ValueError('r must satisfy 0 < 2*r <= image_size')
        factor = model_factor
        self.r = r
        self.model_factor = model_factor
        filters = [64 // factor, 128 // factor, 256 // factor, 512 // factor, 1024 // factor]
        self.lowpass = LowPassFilter(r=r)
        self.pad = ZeroPadding(size=image_size, r=r)
        self.encoder1 = ComplexConvBlock(in_channels, 64 // factor)
        self.anti1 = ComplexLowpass(filt_size=3, stride=2, channels=64 // factor)
        self.encoder2 = ComplexConvBlock(64 // factor, 128 // factor)
        self.anti2 = ComplexLowpass(filt_size=3, stride=2, channels=128 // factor)
        self.encoder3 = ComplexConvBlock(128 // factor, 256 // factor, drop=True)
        self.anti3 = ComplexLowpass(filt_size=3, stride=2, channels=256 // factor)
        self.encoder4 = ComplexConvBlock(256 // factor, 512 // factor, drop=True)
        self.anti4 = ComplexLowpass(filt_size=3, stride=2, channels=512 // factor)
        self.center = ComplexConvBlock(512 // factor, 1024 // factor)
        self.centercbam = ComplexCBAM(1024 // factor, 1024 // factor)
        self.up4 = ComplexConvTranspose2d(1024 // factor, 512 // factor, kernel_size=2, stride=2)
        self.decoder4 = ComplexConvBlock(1024 // factor, 512 // factor)
        self.up3 = ComplexConvTranspose2d(512 // factor, 256 // factor, kernel_size=2, stride=2)
        self.decoder3 = ComplexConvBlock(512 // factor, 256 // factor)
        self.up2 = ComplexConvTranspose2d(256 // factor, 128 // factor, kernel_size=2, stride=2)
        self.decoder2 = ComplexConvBlock(256 // factor, 128 // factor)
        self.up1 = ComplexConvTranspose2d(128 // factor, 64 // factor, kernel_size=2, stride=2)
        self.decoder1 = ComplexConvBlock(128 // factor, 64 // factor)
        self.final_conv = ComplexConv2d(64 // factor, out_channels, kernel_size=1)

    def forward(self, x, return_features=False):
        x = self.lowpass(x)
        input_r = x.real
        input_i = x.imag
        enc1_r, enc1_i = self.encoder1(input_r, input_i)
        pool1_r, pool1_i = self.anti1(enc1_r, enc1_i)
        enc2_r, enc2_i = self.encoder2(pool1_r, pool1_i)
        pool2_r, pool2_i = self.anti2(enc2_r, enc2_i)
        enc3_r, enc3_i = self.encoder3(pool2_r, pool2_i)
        pool3_r, pool3_i = self.anti3(enc3_r, enc3_i)
        enc4_r, enc4_i = self.encoder4(pool3_r, pool3_i)
        pool4_r, pool4_i = self.anti4(enc4_r, enc4_i)
        center_r, center_i = self.center(pool4_r, pool4_i)
        center_r, center_i = self.centercbam(center_r, center_i)
        up4_r, up4_i = self.up4(center_r, center_i)
        dec4_r = torch.cat((up4_r, enc4_r), dim=1)
        dec4_i = torch.cat((up4_i, enc4_i), dim=1)
        dec4_r, dec4_i = self.decoder4(dec4_r, dec4_i)
        up3_r, up3_i = self.up3(dec4_r, dec4_i)
        dec3_r = torch.cat((up3_r, enc3_r), dim=1)
        dec3_i = torch.cat((up3_i, enc3_i), dim=1)
        dec3_r, dec3_i = self.decoder3(dec3_r, dec3_i)
        up2_r, up2_i = self.up2(dec3_r, dec3_i)
        dec2_r = torch.cat((up2_r, enc2_r), dim=1)
        dec2_i = torch.cat((up2_i, enc2_i), dim=1)
        dec2_r, dec2_i = self.decoder2(dec2_r, dec2_i)
        up1_r, up1_i = self.up1(dec2_r, dec2_i)
        dec1_r = torch.cat((up1_r, enc1_r), dim=1)
        dec1_i = torch.cat((up1_i, enc1_i), dim=1)
        dec1_r, dec1_i = self.decoder1(dec1_r, dec1_i)
        final_r, final_i = self.final_conv(dec1_r, dec1_i)
        final_r = final_r.float()
        final_i = final_i.float()
        x = torch.complex(final_r, final_i)
        x = self.pad(x)
        x = torch.real(torch.fft.ifft2(x, norm='backward'))
        if return_features:
            return (x, ((dec1_r, dec1_i), (dec2_r, dec2_i), (dec3_r, dec3_i)))
        x = F.sigmoid(x)
        return x

def conv_block(cin, cout, stride=1):
    return nn.Sequential(nn.Conv2d(cin, cout, 3, stride, 1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True), nn.Conv2d(cout, cout, 3, padding=1, groups=cout, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True))

def spectrum_to_spatial(real, imag, size):
    h, w = size
    radius = real.shape[-2] // 2
    if real.shape[-2] % 2 or 2 * radius > h or real.shape[-1] > w // 2 + 1:
        raise ValueError('Cropped spectrum cannot fit the requested spatial grid')
    freq = torch.complex(real.float(), imag.float())
    padded = freq.new_zeros((*freq.shape[:2], h, w // 2 + 1))
    padded[..., :radius, :freq.shape[-1]] = freq[..., :radius, :]
    padded[..., -radius:, :freq.shape[-1]] = freq[..., -radius:, :]
    # Explicitly project self-conjugate columns before the real inverse.
    # Learned coefficients need not satisfy Hermitian symmetry; leaving this
    # implicit can produce batch-dependent CUDA results for complex64 inputs.
    partner = (-torch.arange(h, device=padded.device)) % h
    for column in (0, w // 2):
        edge = padded[..., :, column].clone()
        padded[..., :, column] = 0.5 * (edge + edge.index_select(-1, partner).conj())
    return torch.fft.irfft2(padded, s=(h, w), norm='ortho')

class SkinFusionSeg(nn.Module):

    def __init__(self):
        in_channels, out_channels, r, model_factor, image_size, width, resample = (3, 1, 64, 8, 256, 16, True)
        super().__init__()
        if image_size % 32 or r % 16 or 4 * r > image_size:
            raise ValueError('Require image_size divisible by 32, r divisible by 16, r <= image_size/4')
        if width < 8 or width % 8:
            raise ValueError('width must be a positive multiple of 8')
        self.image_size = image_size
        self.backbone = EncoderDecoder(in_channels, out_channels, r, model_factor, image_size)
        self.spatial = nn.ModuleList([conv_block(in_channels, width, 2), conv_block(width, width, 2), conv_block(width, width, 2)])
        self.spectral_project = nn.ModuleList([nn.Sequential(nn.Conv2d(c // model_factor, width, 1, bias=False), nn.BatchNorm2d(width), nn.ReLU(inplace=True)) for c in (64, 128, 256)])
        self.mix = nn.ModuleList([conv_block(2 * width, width) for _ in range(3)])
        self.context = ContextAggregation([width] * 3, [4, 2, 1], width, width, width, 3, dim='2d')
        self.fusions = nn.ModuleList([FeatureResampler(width, width, compressed_channels=width, feature_resample=resample, feature_resample_group=4) for _ in range(2)])
        self.decode = nn.ModuleList([conv_block(2 * width, width) for _ in range(2)])
        self.head = nn.Conv2d(width, out_channels, 1)
        nn.init.normal_(self.head.weight, std=0.01)
        nn.init.zeros_(self.head.bias)

    def forward(self, x):
        if x.shape[-2:] != (self.image_size, self.image_size):
            raise ValueError('Input size must match image_size')
        coarse_logit, spectra = self.backbone(x, return_features=True)
        features, spatial = ([], x)
        for block, project, mix, (real, imag) in zip(self.spatial, self.spectral_project, self.mix, spectra):
            spatial = block(spatial)
            spectral = project(spectrum_to_spatial(real, imag, spatial.shape[-2:]))
            features.append(mix(torch.cat((spatial, spectral), dim=1)))
        low = features[-1]
        low = low + self.context(features)
        for index, high in enumerate(reversed(features[:-1])):
            _, high, low = self.fusions[index](high, low)
            low = self.decode[index](torch.cat((high, low), dim=1))
        correction = F.interpolate(self.head(low), size=x.shape[-2:], mode='bilinear', align_corners=False)
        return torch.sigmoid(coarse_logit + correction)
