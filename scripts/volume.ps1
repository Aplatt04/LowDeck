# Windows Core Audio per-app volume control
# Usage:
#   List sessions:    .\volume.ps1 -action list
#   Set app volume:   .\volume.ps1 -action set -pid 1234 -volume 0.5
#   Get master vol:   .\volume.ps1 -action getMaster
#   Set master vol:   .\volume.ps1 -action setMaster -volume 0.8

param(
    [string]$action = "list",
    [int]$procId = 0,
    [float]$volume = 1.0
)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace AudioControl {

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        int NotImpl_EnumAudioEndpoints();
        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
        int NotImpl_GetDevice();
        int NotImpl_RegisterEndpointNotificationCallback();
        int NotImpl_UnregisterEndpointNotificationCallback();
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        [PreserveSig]
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int NotImpl_OpenPropertyStore();
        [PreserveSig]
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int NotImpl_GetState();
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionManager2 {
        int NotImpl_GetAudioSessionControl();
        int NotImpl_GetSimpleAudioVolume();
        [PreserveSig]
        int GetSessionEnumerator(out IAudioSessionEnumerator SessionList);
        int NotImpl_RegisterSessionNotification();
        int NotImpl_UnregisterSessionNotification();
        int NotImpl_RegisterDuckNotification();
        int NotImpl_UnregisterDuckNotification();
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionEnumerator {
        [PreserveSig]
        int GetCount(out int SessionCount);
        [PreserveSig]
        int GetSession(int SessionCount, out IAudioSessionControl Session);
    }

    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl {
        [PreserveSig] int GetState(out int pRetVal);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig] int GetGroupingParam(out Guid pRetVal);
        [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    }

    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioSessionControl2 {
        // IAudioSessionControl inherited
        [PreserveSig] int GetState(out int pRetVal);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        [PreserveSig] int GetGroupingParam(out Guid pRetVal);
        [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        [PreserveSig] int GetProcessId(out int pRetVal);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool optOut);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float fLevel, ref Guid EventContext);
        [PreserveSig] int GetMasterVolume(out float pfLevel);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        // Methods must be listed in the same order as Windows' IAudioEndpointVolume
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ClassInterface(ClassInterfaceType.None)]
    public class MMDeviceEnumeratorClass {}

    public class AudioManager {
        private static IMMDevice GetDefaultDevice() {
            var enumeratorType = typeof(MMDeviceEnumeratorClass);
            var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(0, 1, out device); // eRender, eMultimedia
            return device;
        }

        public static List<SessionInfo> ListSessions() {
            var sessions = new List<SessionInfo>();
            var device = GetDefaultDevice();
            var asm2Guid = typeof(IAudioSessionManager2).GUID;
            object asm2obj;
            device.Activate(ref asm2Guid, 23, IntPtr.Zero, out asm2obj);
            var asm2 = (IAudioSessionManager2)asm2obj;
            IAudioSessionEnumerator enumerator;
            asm2.GetSessionEnumerator(out enumerator);
            int count;
            enumerator.GetCount(out count);
            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctrl;
                enumerator.GetSession(i, out ctrl);
                var ctrl2 = ctrl as IAudioSessionControl2;
                if (ctrl2 == null) continue;
                int processId;
                ctrl2.GetProcessId(out processId);
                if (processId == 0) continue;
                string displayName;
                ctrl2.GetDisplayName(out displayName);
                var vol = ctrl as ISimpleAudioVolume;
                float level = 0;
                if (vol != null) {
                    vol.GetMasterVolume(out level);
                }
                string procName = "";
                try {
                    procName = System.Diagnostics.Process.GetProcessById(processId).ProcessName;
                } catch {}
                sessions.Add(new SessionInfo { Pid = processId, ProcessName = procName, DisplayName = displayName ?? procName, Volume = level });
            }
            return sessions;
        }

        public static void SetSessionVolume(int targetPid, float level) {
            var device = GetDefaultDevice();
            var asm2Guid = typeof(IAudioSessionManager2).GUID;
            object asm2obj;
            device.Activate(ref asm2Guid, 23, IntPtr.Zero, out asm2obj);
            var asm2 = (IAudioSessionManager2)asm2obj;
            IAudioSessionEnumerator enumerator;
            asm2.GetSessionEnumerator(out enumerator);
            int count;
            enumerator.GetCount(out count);
            var ctx = Guid.Empty;
            for (int i = 0; i < count; i++) {
                IAudioSessionControl ctrl;
                enumerator.GetSession(i, out ctrl);
                var ctrl2 = ctrl as IAudioSessionControl2;
                if (ctrl2 == null) continue;
                int processId;
                ctrl2.GetProcessId(out processId);
                if (processId == targetPid) {
                    var vol = ctrl as ISimpleAudioVolume;
                    if (vol != null) vol.SetMasterVolume(level, ref ctx);
                }
            }
        }

        public static float GetMasterVolume() {
            var device = GetDefaultDevice();
            var epvGuid = typeof(IAudioEndpointVolume).GUID;
            object epvObj;
            device.Activate(ref epvGuid, 23, IntPtr.Zero, out epvObj);
            var epv = (IAudioEndpointVolume)epvObj;
            float level;
            epv.GetMasterVolumeLevelScalar(out level);
            return level;
        }

        public static void SetMasterVolume(float level) {
            var device = GetDefaultDevice();
            var epvGuid = typeof(IAudioEndpointVolume).GUID;
            object epvObj;
            device.Activate(ref epvGuid, 23, IntPtr.Zero, out epvObj);
            var epv = (IAudioEndpointVolume)epvObj;
            var ctx = Guid.Empty;
            epv.SetMasterVolumeLevelScalar(level, ref ctx);
        }
    }

    public class SessionInfo {
        public int Pid;
        public string ProcessName;
        public string DisplayName;
        public float Volume;
    }
}
"@ -ReferencedAssemblies System.dll

switch ($action) {
    "list" {
        $sessions = [AudioControl.AudioManager]::ListSessions()
        $result = @()
        foreach ($s in $sessions) {
            $result += @{ pid = $s.Pid; name = $s.ProcessName; displayName = $s.DisplayName; volume = [math]::Round($s.Volume, 4) }
        }
        $result | ConvertTo-Json
    }
    "set" {
        [AudioControl.AudioManager]::SetSessionVolume($procId, $volume)
        Write-Output "OK"
    }
    "getMaster" {
        $v = [AudioControl.AudioManager]::GetMasterVolume()
        Write-Output ([math]::Round($v, 4))
    }
    "setMaster" {
        [AudioControl.AudioManager]::SetMasterVolume($volume)
        Write-Output "OK"
    }
}
