# 完整项目包（分卷）

原始文件：`aaa (2).zip`  
原始大小：1372170399 bytes（约 1.37 GB）  
原始 SHA-256：`3354fa7d16bd2283cccfb1d2d7dbdcdd6f007f6746fe98bb784e4dcdae9421f4`

由于 GitHub 普通仓库单文件上限为 100 MB，完整包被切分为 15 个分卷，每个约 90 MB。

## 合并方法

Windows：双击 `合并完整包.cmd`，会在当前目录生成 `aaa_full.zip`。

或 PowerShell：

```powershell
$out = [IO.File]::Create("aaa_full.zip")
Get-ChildItem "aaa_full.zip.part*" | Sort-Object Name | ForEach-Object {
  $in = [IO.File]::OpenRead($_.FullName)
  $in.CopyTo($out)
  $in.Close()
}
$out.Close()
```

合并后请核对 SHA-256：

```text
3354fa7d16bd2283cccfb1d2d7dbdcdd6f007f6746fe98bb784e4dcdae9421f4
```

## 分卷

- aaa_full.zip.part01  94371840 bytes
- aaa_full.zip.part02  94371840 bytes
- aaa_full.zip.part03  94371840 bytes
- aaa_full.zip.part04  94371840 bytes
- aaa_full.zip.part05  94371840 bytes
- aaa_full.zip.part06  94371840 bytes
- aaa_full.zip.part07  94371840 bytes
- aaa_full.zip.part08  94371840 bytes
- aaa_full.zip.part09  94371840 bytes
- aaa_full.zip.part10  94371840 bytes
- aaa_full.zip.part11  94371840 bytes
- aaa_full.zip.part12  94371840 bytes
- aaa_full.zip.part13  94371840 bytes
- aaa_full.zip.part14  94371840 bytes
- aaa_full.zip.part15  50964639 bytes
