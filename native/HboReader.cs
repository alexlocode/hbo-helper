using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class HboReader {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr count, out UIntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly DateTime Epoch = new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc);
  static Dictionary<string,object> profile;
  static Dictionary<int,uint> thresholds;
  static IntPtr handle;
  static Process game;
  static ulong moduleBase;
  static uint? previousExperience, previousRequired;
  static ulong? previousObject;
  static long earned;

  static uint Config(string key) { return Convert.ToUInt32(profile[key]); }
  static void Write(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
  static byte[] Read(ulong address, int size) {
    byte[] data = new byte[size]; UIntPtr read;
    if (!ReadProcessMemory(handle, new IntPtr((long)address), data, (UIntPtr)size, out read) || read.ToUInt64() != (ulong)size)
      throw new Exception("遊戲資料目前無法讀取，請確認已進入角色並重新開始監測。");
    return data;
  }
  public static ulong Resolve(ulong baseAddress, uint rootRva, uint offset, Func<ulong,int,byte[]> read) {
    uint pointer = BitConverter.ToUInt32(read(baseAddress + rootRva,4),0);
    if (pointer < 0x10000 || (pointer & 3) != 0 || (ulong)pointer + offset > uint.MaxValue)
      throw new Exception("角色指標尚未就緒，請进入遊戲角色後重新開始。");
    return (ulong)pointer + offset;
  }
  static int? Level(uint required) {
    int? found = null;
    foreach (KeyValuePair<int,uint> entry in thresholds) if (entry.Value == required) {
      if (found.HasValue) return null;
      found = entry.Key;
    }
    return found;
  }
  public static long Gain(uint before, uint beforeRequired, uint after, uint afterRequired, Dictionary<int,uint> table) {
    if (beforeRequired == afterRequired) {
      if (after < before) throw new Exception("經驗值下降或角色狀態已改變，已停止統計；請重新開始監測。");
      return (long)after - before;
    }
    int previous = 0, current = 0;
    foreach (KeyValuePair<int,uint> entry in table) {
      if (entry.Value == beforeRequired) previous = entry.Key;
      if (entry.Value == afterRequired) current = entry.Key;
    }
    if (previous == 0 || current <= previous) throw new Exception("無法確認跨等級資料，請重新開始監測。");
    long delta = (long)beforeRequired - before + after;
    for (int level=previous+1; level<current; level++) {
      uint required;
      if (!table.TryGetValue(level,out required)) throw new Exception("缺少等級經驗資料。");
      delta += required;
    }
    return delta;
  }
  static object Sample() {
    if (game.HasExited) throw new Exception("遊戲已關閉，請重新開啟遊戲後開始監測。");
    for (int attempt=0; attempt<5; attempt++) {
      ulong first = Resolve(moduleBase,Config("primaryRootRva"),Config("primaryRequiredOffset"),Read);
      ulong second = Resolve(moduleBase,Config("secondaryRootRva"),Config("secondaryRequiredOffset"),Read);
      byte[] a = Read(first,8), b = Read(second,8);
      uint required = BitConverter.ToUInt32(a,0), experience = BitConverter.ToUInt32(a,4);
      if (required != BitConverter.ToUInt32(b,0) || experience != BitConverter.ToUInt32(b,4) ||
          required == 0 || experience >= required || !thresholds.ContainsValue(required)) {
        Thread.Sleep(20); continue;
      }
      if (previousObject.HasValue && previousObject.Value != first)
        throw new Exception("角色資料位置已改變，請重新開始監測以建立新的統計。");
      if (previousExperience.HasValue)
        earned += Gain(previousExperience.Value,previousRequired.Value,experience,required,thresholds);
      previousExperience=experience; previousRequired=required; previousObject=first;
      return new {
        type="sample",
        sample=new {
          timestamp=(long)(DateTime.UtcNow-Epoch).TotalMilliseconds,
          character=(string)null, level=Level(required), experience=experience,
          experienceRequired=required, gold=(int?)null, earnedExperience=earned,
          processId=game.Id
        }
      };
    }
    throw new Exception("角色資料驗證失敗，請確認已進入遊戲角色；此版本暫不顯示未確認的數值。");
  }
  static int SelfTest() {
    Func<ulong,int,byte[]> first = (address,size) => {
      if (address != 0x400000+0x361afc) throw new Exception("Wrong root");
      return BitConverter.GetBytes((uint)0x589cb90);
    };
    Func<ulong,int,byte[]> relocated = (address,size) => {
      if (address != 0x500000+0x361afc) throw new Exception("Wrong relocated root");
      return BitConverter.GetBytes((uint)0x12340000);
    };
    if (Resolve(0x400000,0x361afc,0x1b4,first) != 0x589cd44 ||
        Resolve(0x500000,0x361afc,0x1b4,relocated) != 0x123401b4)
      throw new Exception("Pointer relocation test failed");
    Dictionary<int,uint> table = new Dictionary<int,uint> { {40,1000},{41,1200},{42,1500} };
    if (Gain(990,1000,20,1200,table) != 30 ||
        Gain(990,1000,20,1500,table) != 1230 ||
        Gain(100,1000,150,1000,table) != 50) throw new Exception("Experience test failed");
    bool rejected=false; try { Gain(150,1000,100,1000,table); } catch { rejected=true; }
    if (!rejected) throw new Exception("Reset was not rejected");
    Write(new { type="test",result="PASS",cases=6 });
    return 0;
  }
  public static int Main(string[] args) {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
      string profilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"profile.json");
      profile = Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(profilePath,Encoding.UTF8));
      thresholds = new Dictionary<int,uint>();
      foreach (KeyValuePair<string,object> entry in (Dictionary<string,object>)profile["experienceTable"])
        thresholds.Add(int.Parse(entry.Key),Convert.ToUInt32(entry.Value));
      Process[] matches = Process.GetProcessesByName((string)profile["executableName"]);
      if (matches.Length == 0) throw new Exception("找不到 Holy Beast Online，請先開啟遊戲並登入角色。");
      if (matches.Length != 1) throw new Exception("偵測到多個遊戲程序，請先保留一個遊戲視窗。");
      game = matches[0];
      string gamePath = game.MainModule.FileName;
      string hash;
      using (SHA256 sha = SHA256.Create())
      using (FileStream stream = File.OpenRead(gamePath))
        hash=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");
      if (!string.Equals(hash,(string)profile["sha256"],StringComparison.OrdinalIgnoreCase))
        throw new Exception("遊戲版本與目前指標設定不同，需更新讀取設定後再使用。");
      moduleBase=(ulong)game.MainModule.BaseAddress.ToInt64();
      handle=OpenProcess(0x1010,false,(uint)game.Id);
      if (handle == IntPtr.Zero) throw new Exception("Windows 拒絕讀取遊戲程序，請確認遊戲與助手的執行權限相符。");
      string command;
      while ((command=Console.ReadLine()) != null) {
        if (command == "read") Write(Sample());
        else if (command == "quit") break;
        else throw new Exception("Unknown reader command");
      }
      return 0;
    } catch (Exception error) {
      Write(new { type="error",message=error.Message });
      return 1;
    } finally { if (handle != IntPtr.Zero) CloseHandle(handle); if (game != null) game.Dispose(); }
  }
}
