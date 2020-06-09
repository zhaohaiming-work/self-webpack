const config = require('./config.js')
const fs = require('fs')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const path = require('path')
const { transformFromAst } = require('@babel/core')
const fsExtra = require('fs-extra')
const Parser = {
  getAst: path => {
    const content = fs.readFileSync(path, 'utf-8')
    return parser.parse(content, {
      sourceType: 'module'
    })
  },
  getDependecies: (ast, filename) => {
    const dependecies = {}
    // 遍历所有的 import 模块,存入dependecies
    traverse(ast, {
      // 类型为 ImportDeclaration 的 AST 节点 (即为import 语句)
      ImportDeclaration({ node }) {
        const dirname = path.dirname(filename)
        // 保存依赖模块路径,之后生成依赖关系图需要用到
        const filePath = './' + path.join(dirname, node.source.value).replace('\\', '/')
        dependecies[node.source.value] = filePath
      }
    })
    return dependecies
  },
  getCode: (ast) => {
    const { code } = transformFromAst(ast, null, {
      presets: ['@babel/preset-env']
    })
    return code
  }
}

class Compiler {
  constructor(options) {
    const { entry, output } = options
    this.entry = entry
    this.output = output
    this.modules = []
  }
  build(filename) {
    const { getAst, getDependecies, getCode } = Parser
    const ast = getAst(filename)
    const dependecies = getDependecies(ast, filename)
    const code = getCode(ast)
    // console.log(code)
    return {
      // 文件路径,可以作为每个模块的唯一标识符
      filename,
      // 依赖对象,保存着依赖模块路径
      dependecies,
      // 文件内容
      code
    }
  }
  run() {
    // 解析入口文件
    const info = this.build(this.entry)
    // console.log(info)
    this.modules.push(info)
    // 判断有依赖对象,递归解析所有依赖项
    for (let i = 0; i < this.modules.length; i++) {
      const item = this.modules[i];
      // 拿到当前模块所依赖的模块
      const { dependecies } = item;
      if (dependecies) {
        // 通过 for-in 遍历对象
        for (let j in dependecies) {
          // 如果子模块又依赖其它模块，就分析子模块的内容
          this.modules.push(this.build(dependecies[j]));
        }
      }
    }
    // 将图谱的数组形式转换成对象形式
    const gragh = {}; 
    this.modules.forEach(item => {
      gragh[item.filename] = {
        dependecies: item.dependecies,
        code: item.code
      }
    })
    // console.log(gragh)
    // console.log(JSON.stringify(this.modules))
    this.generate(gragh)
  }
  // 重写 require函数 (浏览器不能识别commonjs语法),输出bundle
  generate(code) {
    // 输出文件路径
    const filePath = path.join(this.output.path, this.output.filename)
    // console.log(filePath)
    !fsExtra.existsSync(filePath) && fsExtra.mkdirSync(this.output.path)
    fsExtra.emptyDirSync(this.output.path)
    const bundle = `(function(graph){
      function require(moduleId){ 
        function localRequire(relativePath){
          return require(graph[moduleId].dependecies[relativePath])
        }
        var exports = {};
        (function(require,exports,code){
          eval(code)
        })(localRequire,exports,graph[moduleId].code);
        return exports;
      }
      require('${this.entry}')
    })(${JSON.stringify(code)})`
    // 把文件内容写入到文件系统
    fsExtra.writeFileSync(filePath, bundle, 'utf-8')
  }

}
new Compiler(config).run()