"""Internal tensor operations for SkinFusion-Seg."""
import torch
from torch.nn.functional import relu
import torch.nn as nn
import torch.nn.functional as F
from torch.nn import Module, Parameter, init
from torch.nn import Conv2d
from torch.nn import ConvTranspose2d
import torch.nn.parallel
import numpy as np
from collections import OrderedDict
from itertools import islice
import operator
from torch.nn.modules import Module
from torch.nn import Module

def complex_relu(input_r, input_i, inplace=True):
    return (relu(input_r, inplace), relu(input_i, inplace))

class ComplexReLU(Module):

    def __init__(self, inplace=False):
        super(ComplexReLU, self).__init__()
        self.inplace = inplace

    def forward(self, input_r, input_i):
        return complex_relu(input_r, input_i, inplace=self.inplace)

class ComplexConvTranspose2d(Module):

    def __init__(self, in_channels, out_channels, kernel_size, stride=1, padding=0, output_padding=0, groups=1, bias=True, dilation=1, padding_mode='zeros'):
        super(ComplexConvTranspose2d, self).__init__()
        self.conv_tran_r = ConvTranspose2d(in_channels, out_channels, kernel_size, stride, padding, output_padding, groups, bias, dilation, padding_mode)
        self.conv_tran_i = ConvTranspose2d(in_channels, out_channels, kernel_size, stride, padding, output_padding, groups, bias, dilation, padding_mode)

    def forward(self, input_r, input_i):
        return (self.conv_tran_r(input_r) - self.conv_tran_i(input_i), self.conv_tran_r(input_i) + self.conv_tran_i(input_r))

class ComplexConv2d(Module):

    def __init__(self, in_channels, out_channels, kernel_size=3, stride=1, padding=0, dilation=1, groups=1, bias=True):
        super(ComplexConv2d, self).__init__()
        self.conv_r = Conv2d(in_channels, out_channels, kernel_size, stride, padding, dilation, groups, bias)
        self.conv_i = Conv2d(in_channels, out_channels, kernel_size, stride, padding, dilation, groups, bias)

    def forward(self, input_r, input_i):
        return (self.conv_r(input_r) - self.conv_i(input_i), self.conv_r(input_i) + self.conv_i(input_r))

class _ComplexBatchNorm(Module):

    def __init__(self, num_features, eps=1e-05, momentum=0.1, affine=True, track_running_stats=True):
        super(_ComplexBatchNorm, self).__init__()
        self.num_features = num_features
        self.eps = eps
        self.momentum = momentum
        self.affine = affine
        self.track_running_stats = track_running_stats
        if self.affine:
            self.weight = Parameter(torch.Tensor(num_features, 3))
            self.bias = Parameter(torch.Tensor(num_features, 2))
        else:
            self.register_parameter('weight', None)
            self.register_parameter('bias', None)
        if self.track_running_stats:
            self.register_buffer('running_mean', torch.zeros(num_features, 2))
            self.register_buffer('running_covar', torch.zeros(num_features, 3))
            self.running_covar[:, 0] = 1.4142135623730951
            self.running_covar[:, 1] = 1.4142135623730951
            self.register_buffer('num_batches_tracked', torch.tensor(0, dtype=torch.long))
        else:
            self.register_parameter('running_mean', None)
            self.register_parameter('running_covar', None)
            self.register_parameter('num_batches_tracked', None)
        self.reset_parameters()

    def reset_running_stats(self):
        if self.track_running_stats:
            self.running_mean.zero_()
            self.running_covar.zero_()
            self.running_covar[:, 0] = 1.4142135623730951
            self.running_covar[:, 1] = 1.4142135623730951
            self.num_batches_tracked.zero_()

    def reset_parameters(self):
        self.reset_running_stats()
        if self.affine:
            init.constant_(self.weight[:, :2], 1.4142135623730951)
            init.zeros_(self.weight[:, 2])
            init.zeros_(self.bias)

class ComplexBatchNorm2d(_ComplexBatchNorm):

    def forward(self, input_r, input_i):
        assert input_r.size() == input_i.size()
        assert len(input_r.shape) == 4
        exponential_average_factor = 0.0
        if self.training and self.track_running_stats:
            if self.num_batches_tracked is not None:
                self.num_batches_tracked += 1
                if self.momentum is None:
                    exponential_average_factor = 1.0 / float(self.num_batches_tracked)
                else:
                    exponential_average_factor = self.momentum
        if self.training:
            mean_r = input_r.mean([0, 2, 3])
            mean_i = input_i.mean([0, 2, 3])
            mean = torch.stack((mean_r, mean_i), dim=1)
            with torch.no_grad():
                self.running_mean = exponential_average_factor * mean + (1 - exponential_average_factor) * self.running_mean
            input_r = input_r - mean_r[None, :, None, None]
            input_i = input_i - mean_i[None, :, None, None]
            n = input_r.numel() / input_r.size(1)
            Crr = 1.0 / n * input_r.pow(2).sum(dim=[0, 2, 3]) + self.eps
            Cii = 1.0 / n * input_i.pow(2).sum(dim=[0, 2, 3]) + self.eps
            Cri = input_r.mul(input_i).mean(dim=[0, 2, 3])
            with torch.no_grad():
                self.running_covar[:, 0] = exponential_average_factor * Crr * n / (n - 1) + (1 - exponential_average_factor) * self.running_covar[:, 0]
                self.running_covar[:, 1] = exponential_average_factor * Cii * n / (n - 1) + (1 - exponential_average_factor) * self.running_covar[:, 1]
                self.running_covar[:, 2] = exponential_average_factor * Cri * n / (n - 1) + (1 - exponential_average_factor) * self.running_covar[:, 2]
        else:
            mean = self.running_mean
            Crr = self.running_covar[:, 0] + self.eps
            Cii = self.running_covar[:, 1] + self.eps
            Cri = self.running_covar[:, 2]
            input_r = input_r - mean[None, :, 0, None, None]
            input_i = input_i - mean[None, :, 1, None, None]
        det = Crr * Cii - Cri.pow(2)
        s = torch.sqrt(det)
        t = torch.sqrt(Cii + Crr + 2 * s)
        inverse_st = 1.0 / (s * t)
        Rrr = (Cii + s) * inverse_st
        Rii = (Crr + s) * inverse_st
        Rri = -Cri * inverse_st
        input_r, input_i = (Rrr[None, :, None, None] * input_r + Rri[None, :, None, None] * input_i, Rii[None, :, None, None] * input_i + Rri[None, :, None, None] * input_r)
        if self.affine:
            input_r, input_i = (self.weight[None, :, 0, None, None] * input_r + self.weight[None, :, 2, None, None] * input_i + self.bias[None, :, 0, None, None], self.weight[None, :, 2, None, None] * input_r + self.weight[None, :, 1, None, None] * input_i + self.bias[None, :, 1, None, None])
        return (input_r, input_i)

class anti_aliasing(nn.Module):

    def __init__(self, channels, pad_type='reflect', filt_size=4, stride=2, pad_off=0):
        super(anti_aliasing, self).__init__()
        self.filt_size = filt_size
        self.pad_off = pad_off
        self.pad_sizes = [int(1.0 * (filt_size - 1) / 2), int(np.ceil(1.0 * (filt_size - 1) / 2)), int(1.0 * (filt_size - 1) / 2), int(np.ceil(1.0 * (filt_size - 1) / 2))]
        self.pad_sizes = [pad_size + pad_off for pad_size in self.pad_sizes]
        self.stride = stride
        self.off = int((self.stride - 1) / 2.0)
        self.channels = channels
        if self.filt_size == 1:
            a = np.array([1.0])
        elif self.filt_size == 2:
            a = np.array([1.0, 1.0])
        elif self.filt_size == 3:
            a = np.array([1.0, 2.0, 1.0])
        elif self.filt_size == 4:
            a = np.array([1.0, 3.0, 3.0, 1.0])
        elif self.filt_size == 5:
            a = np.array([1.0, 4.0, 6.0, 4.0, 1.0])
        elif self.filt_size == 6:
            a = np.array([1.0, 5.0, 10.0, 10.0, 5.0, 1.0])
        elif self.filt_size == 7:
            a = np.array([1.0, 6.0, 15.0, 20.0, 15.0, 6.0, 1.0])
        filt = torch.Tensor(a[:, None] * a[None, :])
        filt = filt / torch.sum(filt)
        self.register_buffer('filt', filt[None, None, :, :].repeat((self.channels, 1, 1, 1)))
        self.pad = get_pad_layer(pad_type)(self.pad_sizes)

    def forward(self, inp):
        if self.filt_size == 1:
            if self.pad_off == 0:
                return inp[:, :, ::self.stride, ::self.stride]
            else:
                return self.pad(inp)[:, :, ::self.stride, ::self.stride]
        else:
            return F.conv2d(self.pad(inp), self.filt, stride=self.stride, groups=inp.shape[1])

def get_pad_layer(pad_type):
    if pad_type in ['refl', 'reflect']:
        PadLayer = nn.ReflectionPad2d
    elif pad_type in ['repl', 'replicate']:
        PadLayer = nn.ReplicationPad2d
    elif pad_type == 'zero':
        PadLayer = nn.ZeroPad2d
    else:
        print('Pad type [%s] not recognized' % pad_type)
    return PadLayer

class ComplexLowpass(nn.Module):

    def __init__(self, channels, pad_type='reflect', filt_size=4, stride=2, pad_off=0):
        super(ComplexLowpass, self).__init__()
        self.lowpass_r = anti_aliasing(channels, filt_size=filt_size, stride=stride)
        self.lowpass_i = anti_aliasing(channels, filt_size=filt_size, stride=stride)

    def forward(self, input_r, input_i):
        return (self.lowpass_r(input_r), self.lowpass_i(input_i))

class Sequential_complex(Module):

    def __init__(self, *args):
        super(Sequential_complex, self).__init__()
        if len(args) == 1 and isinstance(args[0], OrderedDict):
            for key, module in args[0].items():
                self.add_module(key, module)
        else:
            for idx, module in enumerate(args):
                self.add_module(str(idx), module)

    def _get_item_by_idx(self, iterator, idx):
        size = len(self)
        idx = operator.index(idx)
        if not -size <= idx < size:
            raise IndexError('index {} is out of range'.format(idx))
        idx %= size
        return next(islice(iterator, idx, None))

    def __getitem__(self, idx):
        if isinstance(idx, slice):
            return self.__class__(OrderedDict(list(self._modules.items())[idx]))
        else:
            return self._get_item_by_idx(self._modules.values(), idx)

    def __setitem__(self, idx, module):
        key = self._get_item_by_idx(self._modules.keys(), idx)
        return setattr(self, key, module)

    def __delitem__(self, idx):
        if isinstance(idx, slice):
            for key in list(self._modules.keys())[idx]:
                delattr(self, key)
        else:
            key = self._get_item_by_idx(self._modules.keys(), idx)
            delattr(self, key)

    def __len__(self):
        return len(self._modules)

    def __dir__(self):
        keys = super(Sequential_complex, self).__dir__()
        keys = [key for key in keys if not key.isdigit()]
        return keys

    def forward(self, input1, input2):
        for module in self._modules.values():
            input1, input2 = module(input1, input2)
        return (input1, input2)

class ComplexSAM(nn.Module):

    def __init__(self, bias=False):
        super(ComplexSAM, self).__init__()
        self.bias = bias
        self.conv = nn.Conv2d(in_channels=2, out_channels=1, kernel_size=7, stride=1, padding=3, dilation=1, bias=self.bias)

    def forward(self, x_r, x_i):
        max_r = torch.max(x_r, 1)[0].unsqueeze(1)
        max_i = torch.max(x_i, 1)[0].unsqueeze(1)
        avg_r = torch.mean(x_r, 1).unsqueeze(1)
        avg_i = torch.mean(x_i, 1).unsqueeze(1)
        concat_r = torch.cat((max_r, avg_r), dim=1)
        concat_i = torch.cat((max_i, avg_i), dim=1)
        output_r = self.conv(concat_r) - self.conv(concat_i)
        output_i = self.conv(concat_r) + self.conv(concat_i)
        output_r = torch.sigmoid(output_r) * x_r
        output_i = torch.sigmoid(output_i) * x_i
        return (output_r, output_i)

class ComplexCAM(nn.Module):

    def __init__(self, channels, r):
        super(ComplexCAM, self).__init__()
        self.channels = channels
        self.r = r
        self.linear = nn.Sequential(nn.Linear(in_features=self.channels, out_features=self.channels // self.r, bias=True), nn.ReLU(inplace=True), nn.Linear(in_features=self.channels // self.r, out_features=self.channels, bias=True))

    def forward(self, x_r, x_i):
        max_r = F.adaptive_max_pool2d(x_r, output_size=1)
        max_i = F.adaptive_max_pool2d(x_i, output_size=1)
        avg_r = F.adaptive_avg_pool2d(x_r, output_size=1)
        avg_i = F.adaptive_avg_pool2d(x_i, output_size=1)
        b, c, _, _ = x_r.size()
        linear_max_r = self.linear(max_r.view(b, c)).view(b, c, 1, 1)
        linear_max_i = self.linear(max_i.view(b, c)).view(b, c, 1, 1)
        linear_avg_r = self.linear(avg_r.view(b, c)).view(b, c, 1, 1)
        linear_avg_i = self.linear(avg_i.view(b, c)).view(b, c, 1, 1)
        output_r = (linear_max_r + linear_avg_r) * x_r
        output_i = (linear_max_i + linear_avg_i) * x_i
        return (output_r, output_i)

class ComplexCBAM(nn.Module):

    def __init__(self, channels, r):
        super(ComplexCBAM, self).__init__()
        self.channels = channels
        self.r = r
        self.sam = ComplexSAM(bias=False)
        self.cam = ComplexCAM(channels=self.channels, r=self.r)

    def forward(self, x_r, x_i):
        output_r, output_i = self.cam(x_r, x_i)
        output_r, output_i = self.sam(output_r, output_i)
        return (output_r + x_r, output_i + x_i)

class LowPassFilter(Module):

    def __init__(self, r):
        super(LowPassFilter, self).__init__()
        self.r = r
        self.fft = torch.fft.fft2

    def forward(self, x):
        r = self.r
        f = self.fft(x)
        f_compress = torch.zeros(x.shape[0], x.shape[1], 2 * r, r, dtype=f.dtype, device=x.device)
        for i in range(x.shape[1]):
            f_compress[:, i, :r, :r] = f[:, i, :r, :r]
            f_compress[:, i, -r:, :r] = f[:, i, -r:, :r]
        return f_compress

class ZeroPadding(Module):

    def __init__(self, size, r):
        super(ZeroPadding, self).__init__()
        self.r = r
        self.size = size

    def forward(self, f):
        r = self.r
        f_compress = torch.zeros(f.size(0), f.size(1), self.size, self.size, dtype=f.dtype, device=f.device)
        f_compress[:, :, :r, :r] = f[:, :, :r, :r]
        f_compress[:, :, -r:, :r] = f[:, :, -r:, :r]
        return f_compress

class ComplexConvBlock(nn.Module):
    expansion = 1

    def __init__(self, in_channels, out_channels, stride=1, filter_size=3, block_size=3, drop=False):
        super().__init__()
        self.residual_function = Sequential_complex(ComplexConv2d(in_channels, out_channels, kernel_size=3, stride=1, padding=1, bias=False), ComplexBatchNorm2d(out_channels), ComplexReLU(inplace=True), ComplexConv2d(out_channels, out_channels * ComplexConvBlock.expansion, kernel_size=3, padding=1, bias=False))

    def forward(self, x1, x2, drop=False):
        x3, x4 = self.residual_function(x1, x2)
        return (x3, x4)
