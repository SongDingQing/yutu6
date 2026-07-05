#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

TUANJIE_ROOT = Path('/Applications/Tuanjie/Hub/Editor/2022.3.62t7/PlaybackEngines/AndroidPlayer')
BUILD_TOOLS = TUANJIE_ROOT / 'SDK/build-tools/34.0.0'
AAPT = BUILD_TOOLS / 'aapt'
APKSIGNER = BUILD_TOOLS / 'apksigner'
ZIPALIGN = BUILD_TOOLS / 'zipalign'
JAVA_HOME = TUANJIE_ROOT / 'OpenJDK'

EXPECTED_PACKAGE = 'com.JoeSong.Simulaid'
EXPECTED_LABEL = '模拟纪元Simulaid'
EXPECTED_MIN_SDK = '22'
EXPECTED_TARGET_SDK = '35'
EXPECTED_MIN_MAX_ASPECT = 4.0
PATCHED_MARKER = b'8rsdk-pre-init-library'
VULNERABLE_MARKER = b'xrsdk-pre-init-library'
LIVE_LIBS = {'libtuanjie.so', 'libil2cpp.so', 'libmain.so'}
PRIVACY_ACTIVITY = 'com.sdq.simulaid.PrivacyConsentActivity'
UNITY_ACTIVITY = 'com.unity3d.player.UnityPlayerActivity'
PRIVACY_PREF_MARKER = b'simulaid_privacy_consent'
PRIVACY_VERSION_MARKER = b'2026-05-18-sdk'
PRIVACY_ANDROID_ID_MARKER = b'AndroidID'


def run(cmd: list[str], env: dict[str, str] | None = None) -> tuple[int, str]:
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    return proc.returncode, proc.stdout


def find_badging_value(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1) if m else None


def read_manifest_float_meta(xmltree: str, meta_name: str) -> float | None:
    if not xmltree or not meta_name:
        return None
    lines = xmltree.splitlines()
    for i, line in enumerate(lines):
        if meta_name not in line:
            continue
        for value_line in lines[i + 1:i + 5]:
            match = re.search(r'android:value\([^)]*\)=\(type 0x4\)0x([0-9a-fA-F]+)', value_line)
            if match:
                raw = int(match.group(1), 16)
                return struct.unpack('!f', raw.to_bytes(4, 'big'))[0]
            match = re.search(r'android:value\([^)]*\)="([0-9]+(?:\.[0-9]+)?)"', value_line)
            if match:
                return float(match.group(1))
    return None


def manifest_activity_block(xmltree: str, activity_name: str) -> str:
    if not xmltree or not activity_name:
        return ''
    lines = xmltree.splitlines()
    for i, line in enumerate(lines):
        if activity_name in line:
            start = i
            while start >= 0 and 'E: activity' not in lines[start]:
                start -= 1
            if start < 0:
                continue
            end = start + 1
            while end < len(lines):
                next_line = lines[end]
                if next_line.startswith('    E: activity') or next_line.startswith('    E: activity-alias'):
                    break
                end += 1
            return '\n'.join(lines[start:end])
    return ''


def block_has_main_launcher(block: str) -> bool:
    return 'android.intent.action.MAIN' in block and 'android.intent.category.LAUNCHER' in block


def main() -> int:
    parser = argparse.ArgumentParser(description='Check Simulaid APK against TapTap release gate requirements.')
    parser.add_argument('apk', type=Path)
    parser.add_argument('--expected-version')
    parser.add_argument('--expected-code')
    args = parser.parse_args()

    apk = args.apk.resolve()
    failures: list[str] = []
    warnings: list[str] = []
    facts: list[str] = []

    if not apk.exists():
        print(f'FAIL apk_missing={apk}')
        return 2

    for tool in [AAPT, APKSIGNER, ZIPALIGN, JAVA_HOME / 'bin/java']:
        if not tool.exists():
            failures.append(f'missing_tool={tool}')

    if not failures:
        rc, badging = run([str(AAPT), 'dump', 'badging', str(apk)])
        if rc != 0:
            failures.append('aapt_badging_failed')
            badging = ''
        package = find_badging_value(r"package: name='([^']+)'", badging)
        version_code = find_badging_value(r"versionCode='([^']+)'", badging)
        version_name = find_badging_value(r"versionName='([^']+)'", badging)
        min_sdk = find_badging_value(r"sdkVersion:'([^']+)'", badging)
        target_sdk = find_badging_value(r"targetSdkVersion:'([^']+)'", badging)
        label = find_badging_value(r"application-label:'([^']+)'", badging)
        native_code = find_badging_value(r"native-code: '([^']+)'", badging)
        facts += [
            f'package={package}', f'versionName={version_name}', f'versionCode={version_code}',
            f'minSdk={min_sdk}', f'targetSdk={target_sdk}', f'label={label}', f'native-code={native_code}'
        ]
        if package != EXPECTED_PACKAGE:
            failures.append(f'package_expected_{EXPECTED_PACKAGE}_got_{package}')
        if label != EXPECTED_LABEL:
            failures.append(f'label_expected_{EXPECTED_LABEL}_got_{label}')
        if min_sdk != EXPECTED_MIN_SDK:
            failures.append(f'minSdk_expected_{EXPECTED_MIN_SDK}_got_{min_sdk}')
        if target_sdk != EXPECTED_TARGET_SDK:
            failures.append(f'targetSdk_expected_{EXPECTED_TARGET_SDK}_got_{target_sdk}')
        if native_code != 'arm64-v8a':
            failures.append(f'native_code_expected_arm64-v8a_got_{native_code}')
        if args.expected_version and version_name != args.expected_version:
            failures.append(f'versionName_expected_{args.expected_version}_got_{version_name}')
        if args.expected_code and version_code != args.expected_code:
            failures.append(f'versionCode_expected_{args.expected_code}_got_{version_code}')
        if "uses-gl-es: '0x30000'" not in badging:
            failures.append('missing_gles3_feature')
        if "uses-feature: name='android.hardware.vulkan.version'" in badging:
            failures.append('vulkan_feature_must_not_be_required')
        elif "uses-feature-not-required: name='android.hardware.vulkan.version'" in badging:
            warnings.append('vulkan_feature_optional_but_unneeded_for_simulaid')

        rc, xmltree = run([str(AAPT), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'])
        if rc != 0:
            failures.append('aapt_manifest_xmltree_failed')
        else:
            if 'E: compatible-screens' in xmltree:
                failures.append('manifest_contains_compatible_screens_filter')
            if 'E: supports-gl-texture' in xmltree:
                failures.append('manifest_contains_supports_gl_texture_filter')
            if 'android.hardware.vulkan.' in xmltree:
                failures.append('manifest_contains_vulkan_feature_filter')
            if 'android.permission.INTERNET' in xmltree:
                failures.append('manifest_contains_internet_permission')
            if 'android.permission.ACCESS_NETWORK_STATE' in xmltree:
                failures.append('manifest_contains_access_network_state_permission')
            for attr in ['requiresSmallestWidthDp', 'compatibleWidthLimitDp', 'largestWidthLimitDp']:
                if attr in xmltree:
                    failures.append(f'manifest_contains_screen_width_limit_{attr}')
            max_aspect = read_manifest_float_meta(xmltree, 'android.max_aspect')
            facts.append('manifest.android.max_aspect=' + ('missing' if max_aspect is None else f'{max_aspect:.2f}'))
            if max_aspect is None or max_aspect + 0.001 < EXPECTED_MIN_MAX_ASPECT:
                failures.append(f'manifest_android_max_aspect_below_{EXPECTED_MIN_MAX_ASPECT:g}')
            if 'android.hardware.screen.portrait' in xmltree and 'android:required(0x0101028e)=(type 0x12)0x0' not in xmltree:
                warnings.append('portrait_feature_present_but_optional_flag_not_confirmed')
            privacy_block = manifest_activity_block(xmltree, PRIVACY_ACTIVITY)
            unity_block = manifest_activity_block(xmltree, UNITY_ACTIVITY)
            facts.append('privacy_activity_launcher=' + str(block_has_main_launcher(privacy_block)))
            facts.append('unity_activity_launcher=' + str(block_has_main_launcher(unity_block)))
            if not privacy_block:
                failures.append('privacy_activity_missing')
            elif not block_has_main_launcher(privacy_block):
                failures.append('privacy_activity_not_launcher')
            if block_has_main_launcher(unity_block):
                failures.append('unity_activity_still_launcher_preconsent_risk')

            rc, resources = run([str(AAPT), 'dump', 'resources', str(apk)])
            if rc != 0:
                failures.append('aapt_resources_failed')
            elif 'raw/simulaid_private_policy' not in resources:
                failures.append('raw_privacy_policy_resource_missing')

        rc, zipalign_out = run([str(ZIPALIGN), '-c', '-p', '4', str(apk)])
        if rc != 0:
            failures.append('zipalign_failed')
        else:
            facts.append('zipalign=ok')

        env = dict(__import__('os').environ)
        env['JAVA_HOME'] = str(JAVA_HOME)
        env['PATH'] = str(JAVA_HOME / 'bin') + ':' + env.get('PATH', '')
        rc, sign_out = run([str(APKSIGNER), 'verify', '--verbose', str(apk)], env=env)
        if rc != 0 or 'Verifies' not in sign_out:
            failures.append('apksigner_verify_failed')
        else:
            facts.append('apksigner=ok')

    with zipfile.ZipFile(apk) as z:
        names = z.namelist()
        lib_dirs = sorted({n.split('/')[1] for n in names if n.startswith('lib/') and len(n.split('/')) > 2})
        facts.append('lib_dirs=' + ','.join(lib_dirs))
        if lib_dirs != ['arm64-v8a']:
            failures.append('lib_dirs_expected_only_arm64-v8a_got_' + ','.join(lib_dirs))
        try:
            arsc = z.getinfo('resources.arsc')
            facts.append('resources.arsc.stored=' + str(arsc.compress_type == zipfile.ZIP_STORED))
            if arsc.compress_type != zipfile.ZIP_STORED:
                failures.append('resources.arsc_not_stored_uncompressed')
        except KeyError:
            failures.append('resources.arsc_missing')

        vulnerable_total = patched_total = 0
        live_f2 = []
        dex_bytes = bytearray()
        for n in names:
            if n.endswith('.dex'):
                dex_bytes.extend(z.read(n))
            if not n.startswith('lib/arm64-v8a/') or not n.endswith('.so'):
                continue
            data = z.read(n)
            base = Path(n).name
            vulnerable_total += data.count(VULNERABLE_MARKER)
            patched_total += data.count(PATCHED_MARKER)
            if base in LIVE_LIBS and data.count(b'2022.3.62f2'):
                live_f2.append(base)
        facts.append(f'cve_vulnerable_marker_count={vulnerable_total}')
        facts.append(f'cve_patched_marker_count={patched_total}')
        if vulnerable_total:
            failures.append('vulnerable_xrsdk_marker_still_present')
        if not patched_total:
            failures.append('patched_8rsdk_marker_missing')
        if live_f2:
            failures.append('live_runtime_version_rewritten_to_f2=' + ','.join(live_f2))
        for marker, label in [
            (b'PrivacyConsentActivity', 'privacy_activity_dex_marker_missing'),
            (PRIVACY_PREF_MARKER, 'privacy_pref_dex_marker_missing'),
            (PRIVACY_VERSION_MARKER, 'privacy_version_dex_marker_missing'),
            (PRIVACY_ANDROID_ID_MARKER, 'privacy_androidid_copy_dex_marker_missing'),
        ]:
            if marker not in dex_bytes:
                failures.append(label)

    status = 'PASS' if not failures else 'FAIL'
    print('status=' + status)
    for fact in facts:
        print('fact ' + fact)
    for warning in warnings:
        print('warning ' + warning)
    for failure in failures:
        print('failure ' + failure)
    return 0 if not failures else 1


if __name__ == '__main__':
    raise SystemExit(main())
