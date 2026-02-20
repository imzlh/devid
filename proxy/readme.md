# vproxy
很多R18站点都被GFW屏蔽，被ban了，所以我们需要一个代理
为了这个，且devid项目并不需要太高深的代理程序，我们推荐使用
Deno Deploy的 **免费** 服务。每月100G还不够用？

# 部署项目
不用多复杂，直接在Deno Deploy上部署即可。
0. 先fork项目
1. 登录Deno Deploy
2. 点击“新建项目”
3. 选择“从GitHub仓库部署”
4. 启动命令输入`deno task proxy`。建议配置私人路径
5. 点击“部署”

# 配置项目
打开`config.json`文件，修改`proxy.gateway`为你的项目地址。
这里强烈建议设置私人路径，防止被人滥用。
方法也很简单，设置环境变量`PROXY_PATH`为你设置的私人路径

# 安全吗？
100%安全！Deno Deploy没有被GFW重点关照，且自带SSL，安全的很!